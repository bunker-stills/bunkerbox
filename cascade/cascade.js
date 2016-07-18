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
var component_class = require("./lib/component");

nunjucks.configure(__dirname + "/web", {autoescape: true});

var API_ROOT = "/api/processes";

var COMPONENT_BY_ID_BASE = "component/by_id/";
var COMPONENT_BY_CLASS_BASE = "component/by_class/";

var cascade = function (config) {
    var self = this;

    this.processes = {};

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
        username: undefined,
        password: undefined,
        data_recorder_enabled: false,
        data_recorder_host: "localhost",
        data_recorder_port: 8089,
        processes: []
    });

    this.local_components = {};
    this.remote_components = {};
    this.component_create_callbacks = {};
    this.mqtt_clients = {};
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

    this.api_server.use(function (req, res, next) {
        if (config.username || config.password) {
            if (!req.authorization || !req.authorization.basic || req.authorization.basic.username != config.username || req.authorization.basic.password != config.password) {
                res.header("www-authenticate", 'Basic realm="cascade"');
                return next(new restify.UnauthorizedError());
            }
        }

        next();
    });

    /*var serve_static = restify.serveStatic({
     directory: __dirname + '/web',
     default: 'index.html'
     });*/

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

    if (config.username || config.password) {
        this.mqtt_server.authenticate = function (client, username, password, callback) {

            password = (password) ? password.toString() : undefined;

            var authorized = (username === config.username && password === config.password);

            if (authorized) {
                self.log_info("MQTT Client " + client.id + " successful login");
                client.user = username;
            }
            else {
                self.log_info("MQTT Client " + client.id + " invalid login");
            }

            callback(null, authorized);
        }
    }

    this.mqtt_server.on('published', function (packet, client) {

        if (client) {
            /*var matches = set_component_regex.exec(packet.topic);

             if (_.isArray(matches) && matches.length >= 2) {
             var process_id = matches[1];
             var component_id = matches[2];

             if (self.processes[process_id] && self.processes[process_id].components[component_id]) {
             var component = self.processes[process_id].components[component_id];

             if (!component.read_only) {
             component.value = packet.payload;
             }
             }
             }*/
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

var component_id_topic_regex = new RegExp("^" + COMPONENT_BY_ID_BASE + "([^\/]+)");
function get_component_id_from_topic(topic) {
    var matches = component_id_topic_regex.exec(topic);

    if (_.isArray(matches) && matches.length >= 2) {
        return matches[1];
    }

    return null;
}

cascade.prototype.create_component = function (config) {
    var self = this;
    var new_component = new component_class(config);

    if (new_component.id) {

        self.local_components[new_component.id] = new_component;

        self.publish_mqtt_message(COMPONENT_BY_ID_BASE + new_component.id + "/info", JSON.stringify(new_component.get_serializable_object()), true);

        new_component.on("value_updated", function () {

            self.publish_mqtt_message(COMPONENT_BY_ID_BASE + new_component.id, new_component.value.toString(), false);

            if (new_component.class) {
                self.publish_mqtt_message(COMPONENT_BY_CLASS_BASE + new_component.class + "/" + new_component.id, new_component.value.toString(), false);
            }
        });

        self.process_component_create_callbacks(new_component.id, new_component);
    }

    return new_component;
};

cascade.prototype.process_component_create_callbacks = function (component_id, component) {
    var callbacks = this.component_create_callbacks[component_id];
    delete this.component_create_callbacks[component_id];

    _.each(callbacks, function (callback) {
        callback(null, component);
    });
};

function normalize_component_id(component_id, cascade_server) {
    if (cascade_server) {
        component_id += ":" + cascade_server.toLowerCase();
    }

    return component_id;
}

// If cascade_server is not specified we assume it's the local server
cascade.prototype.require_component = function (component_uri, callback) {
    var self = this;

    var component_id;
    var cascade_server;
    var uri = url.parse(component_uri);

    // This is a local uri
    if(!uri.host)
    {
        component_id = component_uri;
    }
    else // This is a remote server
    {
        component_id = uri.path.slice(1);
        cascade_server = component_uri.slice(0, -uri.path.length);
    }

    var normalized_component_id = normalize_component_id(component_id, cascade_server);
    var callbacks = self.component_create_callbacks[normalized_component_id];

    if (!callbacks) {
        callbacks = [];
        self.component_create_callbacks[normalized_component_id] = callbacks;
    }

    callbacks.push(callback);

    var component;

    if (!cascade_server) {
        component = self.local_components[normalized_component_id];
    }
    else {
        component = self.remote_components[normalized_component_id];

        if (!component) {

            var mqtt_client = self.mqtt_clients[cascade_server];

            if (!mqtt_client) {
                mqtt_client = mqtt.connect(cascade_server);
                self.mqtt_clients[cascade_server] = mqtt_client;

                mqtt_client.on('error', function(err){
                    self.log_error(err);
                });

                mqtt_client.on('message', function (topic, message) {

                    message = message.toString();
                    var topic_component_id = get_component_id_from_topic(topic);
                    var remote_component_id = normalize_component_id(topic_component_id, cascade_server);

                    var component = self.remote_components[remote_component_id];

                    // This is an info update for our component
                    if (/\/info$/.test(topic)) {

                        if (!component) {
                            try {
                                var component_config = JSON.parse(message);

                                var new_component = new component_class(component_config);
                                self.remote_components[remote_component_id] = new_component;
                                self.process_component_create_callbacks(remote_component_id, new_component);
                            }
                            catch (e) {
                            }
                        }
                        else // TODO: Update the existing component
                        {
                        }
                    }
                    else if (topic == (COMPONENT_BY_ID_BASE + topic_component_id) && component) // This is a value update for our component
                    {
                        component.value = message;
                    }
                });
            }

            mqtt_client.subscribe(COMPONENT_BY_ID_BASE + component_id + "/info");
            mqtt_client.subscribe(COMPONENT_BY_ID_BASE + component_id);
        }
    }

    if (component) {
        self.process_component_create_callbacks(normalized_component_id, component);
    }
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

/*cascade.prototype.record_data = function (measurement_name, values, tags, timestamp_in_ms) {
    if (this.data_recorder) {
        this.data_recorder.record(measurement_name, values, tags, timestamp_in_ms);
    }
};*/

cascade.prototype.publish_mqtt_message = function (topic, message, retain) {
    if (!this.mqtt_server) return;

    this.mqtt_server.publish({
        topic: topic,
        payload: message,
        qos: 0,
        retain: retain
    });
};

cascade.prototype.COMPONENT_BY_ID_BASE = COMPONENT_BY_ID_BASE;
cascade.prototype.COMPONENT_BY_CLASS_BASE = COMPONENT_BY_CLASS_BASE;

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