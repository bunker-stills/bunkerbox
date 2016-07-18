var path = require("path");
var url = require("url");
var _ = require("underscore");
var component = require("./component");

var process_class = function (cascade, process_path, root_path) {
    var path_location = path.resolve(root_path || process.cwd(), process_path);

    var self = this;

    try {
        this.process_instance = require(path_location);
    }
    catch (e) {
        cascade.log_error("Unable to load process at '" + process_path + "'");
        cascade.log_error(e);
        return null;
    }

    this.start_time = new Date();

    var process_id = process_class.get_id(process_path, root_path);

    cascade.log_info("Loading process '" + process_id + "'");

    this.path = "processes/" + process_id;
    this.id = process_id;
    this.required_components = {};
    this.name = this.process_instance.name || process_id;
    this.description = this.process_instance.description;
    this.cascade_context = {
        cascade_server: cascade,
        UNITS: component.UNITS,
        TYPES: component.TYPES,
        log_info: function (message) {
            cascade.console_logger.info("(" + process_id + ") " + message);
            cascade.publish_mqtt_message("log/info/" + process_id, message);
        },
        log_error: function (error) {
            cascade.console_logger.error("(" + process_id + ") " + error);
            cascade.publish_mqtt_message("log/error/" + process_id, error);
        },
        log_warning: function (message) {
            cascade.console_logger.warn("(" + process_id + ") " + message);
            cascade.publish_mqtt_message("log/warning/" + process_id, message);
        },
        require_process: function (process_path) {
            return cascade.load_process(process_path, path.dirname(path_location));
        },
        require_component : function(component_uri, callback)
        {
            //self.required_components[component_uri] = callback;
            return cascade.require_component(component_uri, callback);
        },
        create_component: function(config)
        {
            return cascade.create_component(config);
        }
    };

    if (_.isFunction(self.process_instance.setup)) {
        self.process_instance.setup.call(self.process_instance, self.cascade_context);
    }
};

process_class.get_id = function (process_path, root_path) {
    var path_location = path.resolve(root_path || process.cwd(), process_path);
    return path.basename(path_location, path.extname(path_location));
};

module.exports = process_class;
