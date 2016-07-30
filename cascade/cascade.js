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
        mqtt_port: 1883,
        admin_username: "admin",
        admin_password: "admin",
        read_only_username: undefined,
        read_only_password: undefined,
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

    function authenticate_web (req, res, next) {

        var requires_auth = (config.admin_username || config.admin_password || config.read_only_username || config.read_only_password);

        if (requires_auth) {

            if(req.authorization.basic) {
                if (req.authorization.basic.username == config.admin_username && req.authorization.basic.password == config.admin_password) {
                    return next();
                }

                if (req.method = "GET" && req.authorization.basic.username == config.read_only_username && req.authorization.basic.password == config.read_only_password) {
                    return next();
                }
            }

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

    this.mqtt_server = new mosca.Server({
        port: config.mqtt_port,
        persistence: {
            factory: mosca.persistence.Memory
        }
    });

    this.mqtt_server.attachHttpServer(this.api_server);

    this.mqtt_server.authenticate = function (client, username, password, callback) {

        password = (password) ? password.toString() : undefined;

        if ((config.admin_username || config.admin_password) && (username === config.admin_username && password === config.admin_password)) {
            client.user = "admin";
        }
        else if (config.read_only_username || config.read_only_password) {
            if (username === config.read_only_username && password === config.read_only_password) {
                client.user = "read_only";
            }
        }
        else {
            client.user = "read_only";
        }

        var authorized = !_.isUndefined(client.user);

        if (authorized) {
            self.log_info("MQTT Client " + client.id + " logged in as " + client.user);
        }

        callback(null, authorized);
    };

    this.mqtt_server.authorizePublish = function (client, topic, payload, callback) {
        callback(null, (client.user === "admin")); // Must be an admin user to publish
    };

    this.mqtt_server.authorizeSubscribe = function (client, topic, callback) {
        callback(null, (client.user === "admin" || client.user === "read_only"));
    };

    this.mqtt_server.on('published', function (packet, client) {

        if (client) {
            // Look for messages to tell us to change our component value
            var component_id = common.get_component_id_from_topic(packet.topic);
            var component = self.components[component_id];

            if (component) {
                if (/\/set$/.test(packet.topic)) {
                    if (!component.read_only) {
                        component.value = packet.payload.toString();
                    }
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
};
util.inherits(cascade, event_emitter);

cascade.prototype.create_component = function (config, process_id) {
    var self = this;
    var new_component = new component_class(config);
    new_component.process_id = process_id;

    if (new_component.id) {

        self.components[new_component.id] = new_component;

        self.publish_mqtt_message(common.COMPONENT_BY_ID_BASE + new_component.id + "/info", JSON.stringify(new_component.get_serializable_object()), true);

        if (new_component.class) {
            self.publish_mqtt_message(common.COMPONENT_BY_CLASS_BASE + new_component.class + "/" + new_component.id + "/info", JSON.stringify(new_component.get_serializable_object()), true);
        }

        new_component.on("value_updated", function () {

            self.publish_mqtt_message(common.COMPONENT_BY_ID_BASE + new_component.id, new_component.value.toString(), false);

            if (new_component.class) {
                self.publish_mqtt_message(common.COMPONENT_BY_CLASS_BASE + new_component.class + "/" + new_component.id, new_component.value.toString(), false);
            }
        });
    }

    this.emit("new_component", new_component);

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