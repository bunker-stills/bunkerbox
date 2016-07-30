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
        if(/\/info$/.test(topic))
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
                            this.value.toString(),
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
                component.value = message;
                delete component.prevent_update;
            }
        }
    });
};
util.inherits(component_cache, event_emitter);

component_cache.prototype.get_components_by_class = function(component_class)
{
    this.mqtt_client.subscribe(common.COMPONENT_BY_CLASS_BASE + component_class + "/+/info");
    return this.components_by_class[component_class] || {};
};

component_cache.prototype.get_components_by_id = function(component_id)
{
    this.mqtt_client.subscribe(common.COMPONENT_BY_ID_BASE + component_id + "/info");
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

    function add_component(component)
    {
        if(_.isUndefined(component))
        {
            return;
        }

        if(required_components[component.id] || required_classes[component.class])
        {
            components[component.id] = component;

            if(!_.isFunction(self[component.id]))
            {
                self[component.id] = component;
            }
        }
    }

    function attach_to_new_component_event(cache)
    {
        // Only allow it to be attached once.
        if(cache.listeners("new_component").indexOf(add_component) == -1) {
            cache.on("new_component", add_component);
        }
    }

    this.require_component = function(component_id, options, server)
    {
        required_components[component_id] = component_id;

        var existing_component;

        if(!server)
        {
            attach_to_new_component_event(cascade);
            existing_component = cascade.components[component_id];
        }
        else
        {
            var cache = component_cache.get_cache_for_server(server);
            attach_to_new_component_event(cache);

            existing_component = cache.get_components_by_id(component_id);
        }

        if(existing_component)
        {
            add_component(existing_component);
        }
    };

    this.require_component_class = function(component_class, server)
    {
        required_classes[component_class] = true;

        var existing_components;

        if(!server)
        {
            attach_to_new_component_event(cascade);
            existing_components = _.where(cascade.components, {class:component_class});
        }
        else
        {
            var cache = component_cache.get_cache_for_server(server);
            attach_to_new_component_event(cache);
            existing_components = cache.get_components_by_class(component_class);
        }

        _.each(existing_components, function(component){
            add_component(component);
        });
    };
};

module.exports = component_bundle;