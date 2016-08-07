var event_emitter = require('events').EventEmitter;
var util = require("util");

var _ = require("underscore");
var mqtt = require('mqtt');
var common = require("./common");
var cascade_component = require("./component");

var component_cache = function(server)
{
    var self = this;

    this.components_by_id = {};
    this.components_by_class = {};

    this.mqtt_client = mqtt.connect(server);
    this.mqtt_client.on('error', function (err) {

    });

    this.mqtt_client.on('message', function (topic, message) {

        var component_id = common.get_component_id_from_topic(topic);
        var component_value_topic = common.COMPONENT_BY_ID_BASE + component_id;
        message = message.toString();

        var component = self.components_by_id[component_id];

        // This is the definition of a component
        if(/\/detail$/.test(topic))
        {
            if(!component)
            {
                try
                {
                    var component_config = JSON.parse(message);
                }
                catch(e)
                {
                }

                var new_component = new cascade_component(component_config);

                new_component.on("value_updated", function(){

                    // TODO: we'll probably need to put some sort of mutex here
                    if(!this.prevent_update)
                    {
                        if(this.read_only)
                        {
                            throw "Component '" + this.id + "' is read only.";
                        }

                        self.mqtt_client.publish(
                            common.COMPONENT_BY_ID_BASE + this.id + "/set",
                            JSON.stringify(this.value),
                            {
                                qos: 1,
                                retain: false
                            }
                        );
                    }
                });

                // Subscribe to values for this component
                self.mqtt_client.subscribe(component_value_topic);

                self.add_component(new_component);
            }
        }
        // This is a value update for the component
        else if(topic == component_value_topic)
        {
            if(component) // Component should always be here, but just check to make sure
            {
                component.prevent_update = true;
                component.value = JSON.parse(message);
                delete component.prevent_update;
            }
        }
    });
};
util.inherits(component_cache, event_emitter);

component_cache.prototype.get_components_by_class = function(component_class)
{
    this.mqtt_client.subscribe(common.COMPONENT_BY_CLASS_BASE + component_class + "/+/detail");
    return this.components_by_class[component_class] || {};
};

component_cache.prototype.get_components_by_id = function(component_id)
{
    this.mqtt_client.subscribe(common.COMPONENT_BY_ID_BASE + component_id + "/detail");
    return this.components_by_id[component_id] || {};
};

component_cache.prototype.add_component = function(component)
{
    this.components_by_id[component.id] = component;

    this.emit("new_component", component);

    if(component.class)
    {
        var class_components = this.components_by_class[component.class];
        if(!class_components)
        {
            class_components = {};
            this.components_by_class[component.class] = class_components;
        }

        class_components[component.id] = component;
    }
};

component_cache.get_cache_for_server = function(server)
{
    server = server.toLowerCase();

    if(!component_cache.server_cache)
    {
        component_cache.server_cache = {};
    }

    var cache = component_cache.server_cache[server];

    if(!cache)
    {
        cache = new component_cache(server);
        component_cache.server_cache[server] = cache;
    }

    return cache;
};

var component_bundle = function(cascade)
{
    var self = this;

    var components = {};
    var required_components = {};
    var required_classes = {};
    var class_mappers = {};

    function process_add_component(component)
    {
        if(_.isUndefined(component))
        {
            return;
        }

        var callbacks_to_run = [];

        if(required_components[component.id]) {
            callbacks_to_run = callbacks_to_run.concat(required_components[component.id]);
        }

        if(required_classes[component.class])
        {
            callbacks_to_run = callbacks_to_run.concat(required_classes[component.class]);
        }

        if(callbacks_to_run.length > 0)
        {
            components[component.id] = component;

            if(!_.isFunction(self[component.id]))
            {
                self[component.id] = component;
            }

            _.each(callbacks_to_run, function(callback){
                callback(component);
            });
        }
    }

    cascade.on("new_component", process_add_component);

    this.require_component = function(component_id, callback)//, options, server)
    {
        if(!required_components[component_id])
        {
            required_components[component_id] = [];
        }

        if(required_components[component_id].indexOf(callback) === -1)
        {
            required_components[component_id].push(callback);
        }

        // If this component already exists, go ahead and call the callback
        process_add_component(cascade.components[component_id]);
    };

    function mapper_class_callback(new_component)
    {
        var mappers = class_mappers[new_component.class];

        if(mappers)
        {
            _.each(mappers, function(mapper){
                var options = mapper.info.options;

                if(_.isUndefined(options))
                {
                    options = [];
                }

                if(options.indexOf(new_component.id) == -1)
                {
                    options.push(new_component.id);
                }

                mapper.info = { options : options };
            });
        }
    }

    // This allows you to take one component called a mapper, which is a dropdown of other components that correspond
    // to a class. When a component from the dropdown is selected, the value_component will start to mirror the values
    // in the selected component
    this.create_mapper_value_pair_for_class = function(mapper_component, component_class, value_component)
    {
        this.create_mapper_for_class(mapper_component, component_class);

        function update_value()
        {
            value_component.mirror_component(components[mapper_component.value]);
        }

        mapper_component.on("value_updated", update_value);
        update_value();
    };

    this.create_mapper_for_class = function(mapper_component, component_class)
    {
        var mappers = class_mappers[component_class];

        if(!mappers)
        {
            mappers = [];
            class_mappers[component_class] = mappers;
        }

        mappers.push(mapper_component);
        this.require_component_class(component_class, mapper_class_callback);
    };

    this.require_component_class = function(component_class, callback)//, server)
    {
        if(!required_classes[component_class])
        {
            required_classes[component_class] = [];
        }

        if(required_classes[component_class].indexOf(callback) === -1)
        {
            required_classes[component_class].push(callback);
        }

        // If this component already exists, go ahead and call the callback
        _.each(cascade.components, function(component){
            if(component.class === component_class) {
                process_add_component(component);
            }
        });
    };
};
util.inherits(component_bundle, event_emitter);
module.exports = component_bundle;