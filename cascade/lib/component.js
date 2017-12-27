var _ = require("underscore");
var util = require("util");
var utils = require("./utils");
var event_emitter = require('events').EventEmitter;
var round_precision = require("round-precision");

var component = function (config) {

    this.setMaxListeners(200);

    var self = this;

    _.defaults(config, {
        id: "",
        name: "",
        description : "",
        group : "",
        class : "basic_value",
        type: component.TYPES.TEXT,
        read_only : false,
        persist : false,
        info: {},
        value : undefined,
        units : component.UNITS.NONE
    });

    var _config = config;
    var _current_value = null;
    var _value_last_updated = null;

    if(!_.isUndefined(config.value))
    {
        _current_value = config.value;
        _value_last_updated = new Date();
    }

    function create_getter_setter(name, read_only)
    {
        var prop_config = {};

        prop_config.get = function()
        {
            return _config[name];
        };

        if(!read_only)
        {
            prop_config.set = function(value)
            {
                _config[name] = value;
                self.emit("updated", self, name);
            };
        }

        Object.defineProperty(self, name, prop_config);
    }

    create_getter_setter("id", true);
    create_getter_setter("name", true);
    create_getter_setter("description", true);
    create_getter_setter("type", true);
    create_getter_setter("group");
    create_getter_setter("class", true);
    create_getter_setter("read_only", true);
    create_getter_setter("persist", true);
    create_getter_setter("info");
    create_getter_setter("units");

    Object.defineProperty(this, "value", {
        configurable : true,
        get: function () {
            return _current_value;
        },
        set: function (value) {
            if(value === null)
            {
                _current_value = null;
            }
            else {
                switch (_config.type) {
                    case component.TYPES.NUMBER:
                    {
                        if(value === "")
                        {
                            _current_value = null;
                            break;
                        }

                        if (!utils.is_numeric(value)) {
                            // Keep the value the same if it's not a number
                            break;
                        }

                        _current_value = Number(value);

                        break;
                    }
                    case component.TYPES.BUTTON:
                    case component.TYPES.BOOLEAN:
                    {
                        _current_value = (value === true || value === "true" || value === "1" || value === 1);
                        break;
                    }
                    case component.TYPES.BIG_TEXT:
                    case component.TYPES.TEXT:
                    {
                        _current_value = value.toString();
                        break;
                    }
                    default:
                    {
                        _current_value = value;
                    }
                }
            }

            _value_last_updated = new Date();

            self.emit("value_updated", self);
            self.emit("updated", self, "value");
        }
    });

    Object.defineProperty(this, "updated", {
        configurable : true,
        get: function () {
            return _value_last_updated;
        }
    });

    self.mirrored_component = null;
};
util.inherits(component, event_emitter);

component.prototype.mirror_component = function(component)
{
    var self = this;

    // Detach from a previously mirrored component
    if(self.mirrored_component)
    {
        self.mirrored_component.removeListener("updated", self._mirrored_component_callback);
        self.mirrored_component = null;
        delete self._mirrored_component_callback;
    }

    if(component) {

        self._mirrored_component_callback = function(updated_component, value_name)
        {
            if(value_name === "value")
            {
                self.value = convert_value(updated_component.value, updated_component.units, self.units);
            }
            else {
                self[value_name] = updated_component[value_name];
            }
        };

        component.on("updated", self._mirrored_component_callback);
        self.mirrored_component = component;
        // Initialize the value
        self._mirrored_component_callback(component, "value");
    }
    else {
        self.value = null;
    }
};

component.prototype.get_serializable_object = function()
{
    return {
        id : this.id,
        name : this.name,
        description : this.description,
        type : this.type,
        group : this.group,
        class : this.class,
        read_only : this.read_only,
        info : this.info,
        value : this.value,
        updated : this.updated,
        units : this.units,
        process_id : this.process_id
    }
};

component.prototype.seconds_since_last_updated = function()
{
    if(this.updated == null)
    {
        return Infinity;
    }

    return (new Date() - this.updated) / 1000;
};

component.TYPES = {
    TEXT: "TEXT",
    BIG_TEXT: "BIG_TEXT",
    NUMBER: "NUMBER",
    BOOLEAN: "BOOLEAN",
    OPTIONS: "OPTIONS",
    BUTTON: "BUTTON"
};

component.UNITS = {
    NONE: "",
    C: "C",
    F: "F",
    MBAR: "Mbar",
    PERCENTAGE: "%"
};

var conversion_functions = {
    F : {
        C : function(value) { return round_precision((Number(value) - 32) / 1.8, 8) }
    },
    C : {
        F : function(value) { return round_precision(Number(value) * 1.8 + 32, 8) }
    }
};

function convert_value(value, from, to)
{
    if(from == to || from == component.UNITS.NONE || to == component.UNITS.NONE)
    {
        return value;
    }

    var conv_from = conversion_functions[from];

    if(conv_from)
    {
        var conv_to = conv_from[to];

        if(conv_to)
        {
            return conv_to(value);
        }
    }

    throw "Cannot convert from " + from + " to " + to;
}

module.exports = component;