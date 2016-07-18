var _ = require("underscore");
var util = require("util");
var utils = require("./utils");
var event_emitter = require('events').EventEmitter;
var round_precision = require("round-precision");

var component = function (config) {

    var self = this;

    _.defaults(config, {
        id: "",
        name: "",
        description : "",
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
            };
        }

        Object.defineProperty(self, name, prop_config);
    }

    create_getter_setter("id", true);
    create_getter_setter("name");
    create_getter_setter("description");
    create_getter_setter("type");
    create_getter_setter("class");
    create_getter_setter("read_only");
    create_getter_setter("persist");
    create_getter_setter("info");
    create_getter_setter("units", true);

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
                        if (!utils.is_numeric(value)) {
                            throw "Value is not numeric";
                        }

                        _current_value = Number(value);

                        break;
                    }
                    case component.TYPES.BOOLEAN:
                    {
                        _current_value = (value === true || value === "true" || value === "1" || value === 1);
                        break;
                    }
                    case  component.TYPES.TEXT:
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

            this.emit("value_updated");

            if(self.referenced_component && !self._prevent_reference_update)
            {
                self.referenced_component.value = convert_value(_current_value, self.units, self.referenced_component.units);
            }
        }
    });

    Object.defineProperty(this, "updated", {
        configurable : true,
        get: function () {
            return _value_last_updated;
        }
    });
};
util.inherits(component, event_emitter);

component.prototype.get_serializable_object = function()
{
    return {
        id : this.id,
        name : this.name,
        description : this.description,
        type : this.type,
        class : this.class,
        read_only : this.read_only,
        info : this.info,
        units : this.units
    }
};

component.prototype.seconds_since_last_updated = function()
{
    return (new Date() - this.last_updated) / 1000;
};

component.TYPES = {
    TEXT: "TEXT",
    NUMBER: "NUMBER",
    BOOLEAN: "BOOLEAN",
    OPTIONS: "OPTIONS"
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