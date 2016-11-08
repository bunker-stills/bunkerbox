var event_emitter = require('events').EventEmitter;
var util = require("util");

var package_info = require("./package.json");
var winston = require('winston');
var restify = require('restify');
var mosca = require('mosca');
var _ = require("underscore");
var path = require("path");
var url = require("url");
var nunjucks = require("nunjucks");
var mqtt = require('mqtt');

var proc = require("./lib/process");
var common = require("./lib/common");
var component_class = require("./lib/component");

nunjucks.configure(__dirname + "/web", {autoescape: true});

var API_ROOT = "/api";

var cascade = function (config) {

    this.setMaxListeners(100);

    var self = this;

    if (!config) {
        config = {};
    }

    _.defaults(config, {
        title: "cascade",
        run_loop_time_in_seconds: 1,
        data_storage_location: process.cwd() + "/data",
        device_id: "development",
        web_port: 3000,
        enable_mqtt: false,
        mqtt_port: 1883,
        users: {
            "admin": {
                password: "admin",
                can_read: true,
                can_write: true
            }
        },
        data_recorder_enabled: false,
        data_recorder_host: "localhost",
        data_recorder_port: 8089,
        processes: []
    });

    this.processes = {};
    this.components = {};

    this.config = config;

    this.console_logger = new (winston.Logger)({
        transports: [
            new (winston.transports.Console)({
                timestamp: true,
                colorize: true
            })
        ]
    });

    this.log_info("Starting cascade v" + package_info.version);

    if (config.data_recorder_enabled) {
        this.data_recorder = new data_recorder(config.data_recorder_host, config.data_recorder_port);
    }

    this.api_server = restify.createServer();
    this.api_server.use(restify.authorizationParser());
    this.api_server.use(restify.queryParser());
    this.api_server.use(restify.jsonp());
    this.api_server.use(restify.gzipResponse());
    this.api_server.use(restify.bodyParser());

    this.api_server.use(
        function crossOrigin(req, res, next) {
            res.header("Access-Control-Allow-Origin", "*");
            res.header("Access-Control-Allow-Headers", "X-Requested-With");
            return next();
        }
    );

    function authenticate_web(req, res, next) {

        var requires_auth = !_.isUndefined(config.users);

        if (requires_auth) {

            if (req.authorization.basic) {

                var user_info = config.users[req.authorization.basic.username];

                if (user_info && user_info.password === req.authorization.basic.password) {
                    if (req.method === "GET" && user_info.can_read) {
                        return next();
                    }

                    if (req.method === "POST" && user_info.can_write) {
                        return next();
                    }
                }
            }

            // If we get here, the user hasn't been authenticated
            res.header("www-authenticate", 'Basic realm="cascade"');
            return next(new restify.UnauthorizedError());
        }

        next();
    }

    function inject_component(req, res, next) {
        var component = self.components[req.params.component_id];

        if (!component) {
            return res.send(new restify.ResourceNotFoundError());
        }

        if (!req.user_data) req.user_data = {};

        req.user_data.component = component;
        next();
    }

    function format_component(component) {
        var component_info = component.get_serializable_object();
        component_info.process_id = component.process_id;
        return component_info;
    }

    this.api_server.get(API_ROOT + "/", authenticate_web, function (req, res) {

        var processes = {};
        var components = {};

        _.each(self.processes, function (process, process_id) {
            processes[process_id] = {
                id: process_id,
                name: process.name,
                description: process.description
            }
        });

        _.each(self.components, function (component, component_id) {
            components[component_id] = format_component(component);
        });

        res.json({
            version: package_info.version,
            processes: processes,
            components: components
        });
    });

    this.api_server.get(API_ROOT + "/components/:component_id", authenticate_web, inject_component, function (req, res) {
        var component = req.user_data.component;
        res.json(format_component(component));
    });
    this.api_server.post(API_ROOT + "/components/:component_id", authenticate_web, inject_component, function (req, res) {
        var component = req.user_data.component;

        if (component.read_only) {
            return res.send(new restify.MethodNotAllowedError("This component is read only"));
        }

        var value = req.query.value;

        if (_.isUndefined(value)) {
            if (_.isString(req.body)) {
                value = req.body;
            }
            else {
                value = req.body.value;
            }
        }

        if (_.isUndefined(value) || value == "") {
            value = null;
        }

        try {
            component.value = value;
            res.send(format_component(component));
        }
        catch (e) {
            res.send(new restify.BadRequestError(e.toString()));
        }
    });

    var serve_static = restify.serveStatic({
        directory: __dirname + '/web',
        default: 'index.html'
    });

    this.api_server.get(/.*/, function (req, res, next) {

        if (req.url == "/" || req.url == "index.html") {
            res.setHeader('Content-Type', 'text/html');
            res.writeHead(200);
            res.end(nunjucks.render("index.html", {title: config.title}));
        }
        else {
            serve_static(req, res, next);
        }
    });

    this.api_server.server.listen(config.web_port, function () {
        self.log_info("Web server started on port " + config.web_port);
    });

    if(config.enable_mqtt)
    {
        this.mqtt_server = new mosca.Server({
            port: config.mqtt_port,
            persistence: {
                factory: mosca.persistence.Memory
            }
        });

        this.mqtt_server.attachHttpServer(this.api_server);

        this.mqtt_server.authenticate = function (client, username, password, callback) {

            password = (password) ? password.toString() : undefined;

            // If no users are defined, then it's open season
            if (_.isUndefined(config.users)) {
                client.user = {
                    can_read: true,
                    can_write: true
                };
                return callback(null, true);
            }

            client.user = config.users[username];

            if (_.isUndefined(client.user)) {
                callback(null, false);
            }
            else {
                callback(null, (client.user.password === password));
            }
        };

        this.mqtt_server.authorizePublish = function (client, topic, payload, callback) {

            // Don't allow any external services to publish to any topic starting with "read/"
            if(topic.indexOf("read/") === 0)
            {
                return callback(null, false);
            }

            callback(null, client.user.can_write);
        };

        this.mqtt_server.authorizeSubscribe = function (client, topic, callback) {
            callback(null, client.user.can_read);
        };

        this.mqtt_server.on('published', function (packet, client) {

            if (client && client.user.can_write) {
                // Look for messages to tell us to change our component value
                var topic_info = common.parse_write_topic(packet.topic);

                if (topic_info && topic_info.component_id) {
                    var component = self.components[topic_info.component_id];

                    if (component && !component.read_only) {
                        component.value = JSON.parse(packet.payload.toString());
                    }
                }
            }
        });

        this.mqtt_server.on('ready', function () {
            self.log_info("MQTTT broker started on port " + config.mqtt_port);
            self.log_info("Web Socket MQTTT broker started on port " + config.web_port);

            // Load our processes
            var processes_to_load = config.processes;

            if (!_.isArray(processes_to_load)) {
                processes_to_load = [];
                processes_to_load.push(config.processes);
            }

            _.each(processes_to_load, function (process_to_load) {
                self.load_process(process_to_load);
            });

            // Setup our run loop
            setInterval(function () {

                _.each(self.processes, function (ps) {

                    if (_.isFunction(ps.process_instance.loop)) {
                        ps.process_instance.loop.call(ps.process_instance, ps.cascade_context);
                    }

                });

            }, config.run_loop_time_in_seconds * 1000);

        });
    }
};
util.inherits(cascade, event_emitter);

cascade.prototype.publish_component_update = function (component, publish_value_update, publish_detail_update) {
    var topic = "read/" + component.group + "/" + component.class + "/" + component.id;
    var message = JSON.stringify(component.get_serializable_object());

    if (publish_value_update) {
        this.publish_mqtt_message(topic, JSON.stringify(component.value), false);
    }

    if (publish_detail_update) {
        this.publish_mqtt_message(topic + "/detail", message, true);
    }
};

cascade.prototype.create_component = function (config, process_id) {
    var self = this;

    config.group = config.group || process_id;

    var new_component = new component_class(config);

    if (new_component.id) {

        self.components[new_component.id] = new_component;

        self.publish_component_update(new_component, false, true);

        new_component.on("updated", function (the_component, value_name) {
            if (value_name === "value") {
                self.publish_component_update(the_component, true, true);
            }
            else {
                self.publish_component_update(the_component, false, true);
            }
        });
    }

    this.emit("new_component_" + new_component.id, new_component);

    if(new_component.class) {
        this.emit("new_component_class_" + new_component.class, new_component);
    }

    return new_component;
};

cascade.prototype.load_process = function (process_path, root_path) {

    var proc_id = proc.get_id(process_path, root_path);

    if (this.processes[proc_id]) {
        return this.processes[proc_id];
    }

    var new_process = new proc(this, process_path, root_path);

    if (new_process) {
        this.processes[new_process.id] = new_process;
    }

    return new_process;
};

cascade.prototype.publish_mqtt_message = function (topic, message, retain) {
    if (!this.mqtt_server) return;

    this.mqtt_server.publish({
        topic: topic,
        payload: message,
        qos: 0,
        retain: retain
    });
};

cascade.prototype.log_info = function (message) {
    this.console_logger.info(message);
    this.publish_mqtt_message("log/info", "(info) " + message);
};

cascade.prototype.log_error = function (error) {
    this.console_logger.error(error);
    this.publish_mqtt_message("log/error", "(error) " + error);
};

cascade.prototype.log_warning = function (message) {
    this.console_logger.warn(message);
    this.publish_mqtt_message("log/warning", "(warning) " + message);
};

module.exports = cascade;