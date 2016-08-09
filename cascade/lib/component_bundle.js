var event_emitter = require('events').EventEmitter;
var util = require("util");

var _ = require("underscore");
var mqtt = require('mqtt');
var common = require("./common");
var cascade_component = require("./component");

var component_cache = function (server) {
    var self = this;

    this.components = {};

    this.mqtt_client = mqtt.connect(server);
    this.mqtt_client.on('error', function (err) {
    });

    this.mqtt_client.on('message', function (topic, message) {
        var component_config = JSON.parse(message.toString());

        var existing_component = self.components[component_config.id];

        if (!existing_component) {
            var new_component = new cascade_component(component_config);
            self.components[new_component.id] = new_component;
            self.emit("new_component", new_component);
        }
        else {
            existing_component.value = component_config.value;
        }

    });
};
util.inherits(component_cache, event_emitter);

component_cache.prototype.get_components_by_class = function (component_class) {
    this.mqtt_client.subscribe("read/+/" + component_class + "/+/detail");
};

component_cache.prototype.get_components_by_id = function (component_id) {
    this.mqtt_client.subscribe("read/+/+/" + component_id + "/detail");
};

component_cache.get_cache_for_server = function (server) {
    server = server.toLowerCase();

    if (!component_cache.server_cache) {
        component_cache.server_cache = {};
    }

    var cache = component_cache.server_cache[server];

    if (!cache) {
        cache = new component_cache(server);
        component_cache.server_cache[server] = cache;
    }

    return cache;
};

var component_bundle = function (cascade) {
    var class_mappers = {};

    function mapper_class_callback(new_component) {
        var mappers = class_mappers[new_component.class];

        if (mappers) {
            _.each(mappers, function (mapper) {
                var options = mapper.info.options;

                if (_.isUndefined(options)) {
                    options = [];
                }

                if (options.indexOf(new_component.id) == -1) {
                    options.push(new_component.id);
                }

                mapper.info = {options: options};
            });
        }
    }

    // This allows you to take one component called a mapper, which is a dropdown of other components that correspond
    // to a class. When a component from the dropdown is selected, the value_component will start to mirror the values
    // in the selected component
    this.create_mapper_value_pair_for_class = function (mapper_component, component_class, value_component) {
        var self = this;

        this.create_mapper_for_class(mapper_component, component_class);

        function update_value() {
            self.require_component(mapper_component.value, function (component_to_mirror) {
                value_component.mirror_component(component_to_mirror);
            });
        }

        mapper_component.on("value_updated", update_value);
        update_value();
    };

    this.create_mapper_for_class = function (mapper_component, component_class) {
        var mappers = class_mappers[component_class];

        if (!mappers) {
            mappers = [];
            class_mappers[component_class] = mappers;
        }

        mappers.push(mapper_component);
        this.require_component_class(component_class, mapper_class_callback);
    };

    this.require_component = function (component_id, server, callback) {
        if (_.isFunction(server)) {
            callback = server;
            server = null;
        }

        if (server) {

        }
        else {
            if (cascade.components[component_id]) {
                callback(cascade.components[component_id]);
            }
            else {
                cascade.once("new_component", function (component) {
                    if (component.id === component_id) {
                        callback(component);
                    }
                });
            }
        }
    };


    this.require_component_class = function (component_class, server, callback) {
        if (_.isFunction(server)) {
            callback = server;
            server = null;
        }

        if (server) {
            var server_interface = component_cache.get_cache_for_server(server);

            // Existing components
            _.each(server_interface.components, function (component) {
                if (component.class === component_class) {
                    callback(component);
                }
            });

            server_interface.get_components_by_class(component_class);

            // Any new components
            server_interface.on("new_component", function (component) {
                if (component.class === component_class) {
                    callback(component);
                }
            });
        }
        else {
            // Existing components
            _.each(cascade.components, function (component) {
                if (component.class === component_class) {
                    callback(component);
                }
            });

            // Any new components
            cascade.on("new_component", function (component) {
                if (component.class === component_class) {
                    callback(component);
                }
            });
        }

    };
};
util.inherits(component_bundle, event_emitter);
module.exports = component_bundle;