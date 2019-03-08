var _ = require("underscore");
var vm = require("vm");
var pid_controller = require("./pid");

// export the soft resource constructors
module.exports.PID = SoftResource_PID;
module.exports.Variable = SoftResource_Variable;
module.exports.Function = SoftResource_Function;
module.exports.BitOut = SoftResource_BIT_OUT;
module.exports.Relay = SoftResource_RELAY;
module.exports.DutyCycle_Relay = SoftResource_DUTYCYCLE_RELAY;
module.exports.DAC = SoftResource_DAC;
module.exports.Stepper = SoftResource_STEPPER;
module.exports.BitIn = SoftResource_BIT_IN;
module.exports.Distance = SoftResource_DISTANCE;
module.exports.OW_probe = SoftResource_OW_PROBE;
module.exports.TC_probe = SoftResource_TC_PROBE;
module.exports.PTC_probe = SoftResource_PTC_PROBE;
module.exports.TEMP_probe = SoftResource_TEMP_PROBE;
module.exports.Barometer = SoftResource_Barometer;

// export list of soft resource types
module.exports.resource_types = [
    "BitOut",
    "Relay",
    "DutyCycleRelay",
    "DAC",
    "Stepper",
    "BitIn",
    "Distance",
    "OW_probe",
    "TC_probe",
    "PTC_probe",
    "TEMP_probe",
    "Barometer",
    "PID",
    "Variable",
    "Function",
];

module.exports.create_resource_name_list = create_resource_name_list;
//////////////////
// GLOBALS      //
//////////////////
// group oredering using text at start of group name
var FUNCTION_GROUP = "01  Functions";
var PROCESS_CONTROL_GROUP = "02  Process Controls";
var PROCESS_SENSOR_GROUP = "03  Process Sensors";
var pid_group_number = 4;
var SOFT_RESOURCE_LISTS = "70 Soft Resources";
var HR_ASSIGNMENT_GROUP = "80  Resource Assignment";

// Display orders:
var global_display_order = 0;
var next_display_order = function() {
    global_display_order += 1;
    return global_display_order;
};

// Function source text processing
var commentRegex = /\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm;
var stringLiteralRegex = /(['"])(?:(?!(?:\\|\1)).|\\.)*\1/g;
var identifierRegex = /[$A-Z_][0-9A-Z_$]*/gi;
var structuredRegex = /[$A-Z_][0-9A-Z_$]*(\.[$A-Z_][0-9A-Z_$]*)+/gi;

var reserveWords = new Set([
    "abstract", "arguments", "await", "boolean",
    "break", "byte", "case", "catch",
    "char", "class", "const", "continue",
    "debugger", "default", "delete", "do",
    "double", "else", "enum", "eval",
    "export", "extends", "false", "final",
    "finally", "float", "for", "function",
    "goto", "if", "implements", "import",
    "in", "instanceof", "int", "interface",
    "let", "long", "native", "new",
    "null", "package", "private", "protected",
    "public", "return", "short", "static",
    "super", "switch", "synchronized", "this",
    "throw", "throws", "transient", "true",
    "try", "typeof", "var", "void",
]);

/////////////////
// Utilities   //
/////////////////

// support for creating soft resources by list

function create_resource_name_list(cascade, soft_resource_type) {

    let names_component = cascade.create_component({
        id: soft_resource_type + "_names",
        group: SOFT_RESOURCE_LISTS,
        display_order: next_display_order(),
        type: cascade.TYPES.BIG_TEXT,
        persist: true,
    });

    process_names_list(cascade, names_component.value, soft_resource_type);

    names_component.on("value_updated", function() {
        process_names_list(cascade, names_component.value, soft_resource_type);
    });
}

var process_names_list = function(cascade, names_string, soft_resource_type) {
    if (!names_string) return;
    let names = get_name_list(names_string);
    // FOR NOW WE DO NOT REMOVE DELETED NAMES
    //for (let resource of soft[soft_resource_type].get_instances()) {
    //    if (names.getIndex(resource.name)name not in names {
    //        resource.deactivate();
    //        // each SR must deactivate all its components, then delete itself
    //        // pid options should recognize deactivated components and exclude them
    //}    }
    
    // Add any new names
    for (let name of names) {
        if (!module.exports[soft_resource_type].get_instance(name)) {
            new module.exports[soft_resource_type](cascade, name);
        }
    }
};

var name_to_description = function(name) {
    var s = name.replace(/([ ]|^)[a-z]/g, function(match) { return match.toUpperCase(); });
    var description = s.replace(/([ ]|^)[^ ]+/g,
        function(match) {
            let word = match.trim().toLowerCase();
            if (["pid", "dac", "dcr"].indexOf(word) >= 0) {
                return match.toUpperCase();
            }
            return match;
        });
    return description;
};

var name_regex = /[^\s,;]+/g;

var get_name_list = function(s) {
    var names = [];
    s.replace(name_regex, function(name) {names.push(name);});
    return names;
};

var get_name_set = function(s) {
    var names = new Set();
    s.replace(name_regex, function(name) {names.add(name);});
    return names;
};

var add_name_to_list = function(list, name, sorted) {
    if (!name) return;
    let i_name = list.indexOf(name);
    if (i_name >= 0) return;  // already in list
    list.push(name);
    if (sorted) {
        list.sort();
    }
    return name;
};

var remove_name_from_list = function(list, name) {
    if (!name) return;
    let i_name = list.indexOf(name);
    if (i_name < 0) return;
    list.splice(i_name, 1);
    return name;
};

var set_driving_components = function(driver, driven) {
    if (!driver || !driven) return;
    //driven.read_only = true;  not settable
    driven.mirror_component(driver);
};

var unset_driving_components = function(driver, driven) {
    if (!driver || !driven) return;
    if (driven.mirrored_component !== driver) return;
    //driven.read_only = false;  not settable
    driven.mirror_component();
};

/*
var deactivate_component = function(cascade, component) {
    // would like a 'delete_component' operation, but cascade does not support that.
    component.group = "999 Unused Components";
    component.display_order = 0;
    component.info = {};
    component.units = component.UNITS.NONE;
    if (!component.read_only) {
        component.value = undefined;
    }
};
*/

//////////////////////////////////////////////////////////////////////////////
// Barometer resource -- a special case
// Assume there is one barometer and it is named "barometer".
//////////////////////////////////////////////////////////////////////////////
function SoftResource_Barometer(cascade) {
    var self = this;

    this.name = "barometer";
    this.description = "Barometer";
    this.air_pressure = undefined;

    cascade.components.require_component("barometer",
        function(component) {
            component.group = PROCESS_SENSOR_GROUP;  // claim it as our own.
            component.display_order = next_display_order();
            self.air_pressure = component;
        });
}

//////////////////////////////////////////////////////////////////////////////
// Pure soft resources -- no hard resource required
// Base class
//////////////////////////////////////////////////////////////////////////////
function SoftResource_SR(cascade, name) {
    this.name = name;
    this.description = name_to_description(this.name);
    this.instances_of_type[this.name] = this;
}

// Utility to initialize SoftResource_SR subclass prototypes.
// Called once before constructor is executed.
var create_SoftResource_SR_prototype = function() {
    // create a subclass prototype object linked to the superclass.
    var prototype = Object.create(SoftResource_SR.prototype);
    //  Set class properties
    prototype._instances_of_type = {};

    return prototype;
};

// called from subclass constructor to create getters/setters for class properties.
SoftResource_SR.prototype.init_subclass_properties = function(constructor) {
    Object.defineProperties(this,
        {
            instances_of_type: {
                get() { return constructor.prototype._instances_of_type; },
            }
        });
};


//////////////////////
// PID              //
//////////////////////

function SoftResource_PID(cascade, name) {
    var self = this;

    this.init_subclass_properties(SoftResource_PID);
    SoftResource_SR.call(this, cascade, name);

    let pid_group = ("00" + pid_group_number).slice(-2) + "  " + this.description;
    pid_group_number += 1;

    this._pid = new pid_controller();

    this.enable = cascade.create_component({
        id: name + "_enable",
        name: this.description + " Enable",
        group: pid_group,
        display_order: next_display_order(),
        type: cascade.TYPES.BOOLEAN
    });
    this.enable.on("value_updated", function () {
        // Reset our PID
        if (self.enable.value == false) {
            self.i_term.value = null;
            self.control_value.value = 0;
            self._pid.reset();
        }
        else {
            self._pid.setIntegral(self.i_term.value);
        }
    });

    this.set_point = cascade.create_component({
        id: name + "_set_point",
        name: this.description + " Set Point",
        group: pid_group,
        display_order: next_display_order(),
        read_only: false,
        type: cascade.TYPES.NUMBER,
    });

    this.process_component_name = cascade.create_component({
        id: name + "_process_component",
        name: this.description + " Process Component",
        group: pid_group,
        display_order: next_display_order(),
        persist: true,
        type: cascade.TYPES.OPTIONS,
        info: {
            options: []
        }
    });
    this.process_component_name.on("value_updated", function () {
        self.process_component = null;

        cascade.components.require_component(self.process_component_name.value,
            function (component) {
                self.process_component = component;
            });
    });
    this.process_component_name.value = this.process_component_name.value;

    this.process_value = cascade.create_component({
        id: name + "_process_value",
        name: this.description + " Process Value",
        group: pid_group,
        display_order: next_display_order(),
        read_only: true,
        type: cascade.TYPES.NUMBER
    });

    this.control_component_name = cascade.create_component({
        id: name + "_control_component",
        name: this.description + " Control Component",
        group: pid_group,
        display_order: next_display_order(),
        persist: true,
        type: cascade.TYPES.OPTIONS,
        info: {
            options: []
        }
    });
    this.control_component_name.on("value_updated", function () {

        self.control_component = null;

        cascade.components.require_component(self.control_component_name.value,
            function (component) {
                self.control_component = component;
            });
    });
    this.control_component_name.value = this.control_component_name.value;

    this.control_value = cascade.create_component({
        id: name + "_control_value",
        name: this.description + " Control Value",
        group: pid_group,
        display_order: next_display_order(),
        read_only: true,
        type: cascade.TYPES.NUMBER
    });

    this.i_term = cascade.create_component({
        id: name + "_i_term",
        name: this.description + " I Term",
        group: pid_group,
        display_order: next_display_order(),
        read_only: false,
        type: cascade.TYPES.NUMBER
    });

    this.p_gain = cascade.create_component({
        id: name + "_p_gain",
        name: this.description + " P Gain",
        group: pid_group,
        display_order: next_display_order(),
        class_name: "pid_gain",
        persist: true,
        type: cascade.TYPES.NUMBER
    });

    this.i_gain = cascade.create_component({
        id: name + "_i_gain",
        name: this.description + " I Gain",
        group: pid_group,
        display_order: next_display_order(),
        class_name: "pid_gain",
        persist: true,
        type: cascade.TYPES.NUMBER
    });

    this.d_gain = cascade.create_component({
        id: name + "_d_gain",
        name: this.description + " D Gain",
        group: pid_group,
        display_order: next_display_order(),
        class_name: "pid_gain",
        persist: true,
        type: cascade.TYPES.NUMBER
    });

    this.min_cv = cascade.create_component({
        id: name + "_min_cv",
        name: this.description + " Minimum Control Value",
        group: pid_group,
        display_order: next_display_order(),
        persist: true,
        type: cascade.TYPES.NUMBER,
        units: cascade.UNITS.PERCENTAGE
    });

    this.max_cv = cascade.create_component({
        id: name + "_max_cv",
        name: this.description + " Maximum Control Value",
        group: pid_group,
        display_order: next_display_order(),
        persist: true,
        type: cascade.TYPES.NUMBER,
        units: cascade.UNITS.PERCENTAGE
    });

    this.derivative_beta = cascade.create_component({
        id: name + "_d_beta",
        name: this.description + " Derivative Beta",
        group: pid_group,
        display_order: next_display_order(),
        persist: true,
        type: cascade.TYPES.NUMBER,
    });
}

// Link prototype to base class
SoftResource_PID.prototype = create_SoftResource_SR_prototype();

// add psuedo class methods (not inherited by subclasses).
SoftResource_PID.get_instances = function() {
    return SoftResource_PID.prototype._instances_of_type;
};
SoftResource_PID.get_instance = function(name) {
    return SoftResource_PID.prototype._instances_of_type[name];
};

// Add type instance methods
SoftResource_PID.prototype.enable_pid = function() {
    if (!this.enable.value) {
        this.enable.value = true;
        this.update_process_value();
    }
};

SoftResource_PID.prototype.disable_pid = function() {
    if (this.enable.value) {
        this.enable.value = false;
        this.update_process_value();
    }
};

SoftResource_PID.prototype.set_pid_options = function(option_list) {
    this.process_component_name.info = {options: option_list};
    this.control_component_name.info = {options: option_list};
};

SoftResource_PID.prototype.update_process_value = function() {
    if (this.process_component) {
        this.process_value.value = this.process_component.value;
    }
    else {
        this.process_value.value = 0.0;
    }
};

SoftResource_PID.prototype.process_pid = function() {

    this.update_process_value();

    if (this.enable.value == true) {
        this._pid.setControlValueLimits(
            this.min_cv.value || 0.0,
            this.max_cv.value || 0.0,
            0
        );

        this._pid.setProportionalGain(this.p_gain.value || 0.0);
        this._pid.setIntegralGain(this.i_gain.value || 0.0);
        this._pid.setDerivativeGain(this.d_gain.value || 0.0);

        this.derivative_beta.value = Math.max(0,
            Math.min(1, this.derivative_beta.value));
        this._pid.setDerivativeBeta(this.derivative_beta.value || 0.5);

        this._pid.setDesiredValue(this.set_point.value || 0.0);

        this.control_value.value = this._pid.update(this.process_value.value || 0.0);

        if (this.control_component) {
            this.control_component.value = this.control_value.value;
        }

        this.i_term.value = this._pid.getIntegral();
    }
};

//////////////////////
// Variable         //
//////////////////////

function SoftResource_Variable(cascade, vardef) {

    this.init_subclass_properties(SoftResource_Variable);

    if (typeof vardef === "string") {
        let name_parts = vardef.split("/");
        let name = name_parts.shift();
        let read_only = name_parts.includes("r");
        let persist = name_parts.includes("p");
        vardef = {name: name, read_only: read_only, persist: persist};
    }
    SoftResource_SR.call(this, cascade, vardef.name);

    this.component = cascade.create_component({
        id: vardef.name,
        name: (vardef.description || this.description),
        group: (vardef.group || FUNCTION_GROUP),
        display_order: next_display_order(),
        type: cascade.TYPES.NUMBER,
        units: (vardef.units || cascade.UNITS.NONE),
        read_only: vardef.read_only || false,
        persist: vardef.persist || false,
    });

    if (this.component.value) {
        this.component.value = this.component.value;
    }
    else {
        this.component.value = vardef.value;
    }
}

// Link prototype to base class
SoftResource_Variable.prototype = create_SoftResource_SR_prototype();

// add psuedo class methods (not inherited by subclasses).
SoftResource_Variable.get_instances = function() {
    return SoftResource_Variable.prototype._instances_of_type;
};
SoftResource_Variable.get_instance = function(name) {
    return SoftResource_Variable.prototype._instances_of_type[name];
};

//////////////////////
// Function         //
//////////////////////

function SoftResource_Function(cascade, name) {
    var self = this;

    this.init_subclass_properties(SoftResource_Function);
    SoftResource_SR.call(this, cascade, name);

    this.script = undefined;
    this.context = undefined;

    this.enable = cascade.create_component({
        id: name + "_enable",
        name: this.description + " Enable",
        group: FUNCTION_GROUP,
        display_order: next_display_order(),
        type: cascade.TYPES.BOOLEAN,
        value: this.name == "_Init_",
    });
    // Note that _Init_ is the only function that comes up enabled.
    // It can enable other functions and/or disable itself.

    this.code = cascade.create_component({
        id: name + "_code",
        name: this.description + " JavaScript Code",
        group: FUNCTION_GROUP,
        display_order: next_display_order(),
        type: cascade.TYPES.BIG_TEXT,
        persist: true
    });
    
    this.create_script(cascade);
    this.code.on("value_updated", function () {
        self.create_script(cascade);
    });
}

// Link prototype to base class
SoftResource_Function.prototype = create_SoftResource_SR_prototype();

// add psuedo class methods (not inherited by subclasses).
SoftResource_Function.get_instances = function() {
    return SoftResource_Function.prototype._instances_of_type;
};
SoftResource_Function.get_instance = function(name) {
    return SoftResource_Function.prototype._instances_of_type[name];
};

// Add type instance methods
SoftResource_Function.prototype.create_script = function(cascade) {

    var self = this;
    
    if (!this.code.value) {
        this.script = undefined;
        return;
    }

    try {
        var script_code =
                "var _return_value; function custom(){" +
                this.code.value +
                "}; _return_value = custom();";
        this.script = vm.createScript(script_code);
    }
    catch (e) {
        cascade.log_error("ERROR: " + e.toString());
    }
    
    // create the context object
    this.context = {
        console: console,   // for output eg debug, errors, etc.
        myStore: {},        // for persistent data
    };
    
    var source = this.code.value.replace(commentRegex, function() { return "";});
    source = source.replace(stringLiteralRegex, function() { return "";});
    source = source.replace(structuredRegex, function() { return "";});
    source.replace(identifierRegex, function(id) {
        if (reserveWords.has(id)) return;
        self.context[id] = undefined;
    });
};

SoftResource_Function.prototype.process_function = function (cascade) {
    // Evaluate this function
    if (this.enable && this.enable.value && this.script) {

        // Get the current values of all referenced components
        for (let id in this.context) {
            let component = cascade.components.all_current[id];
            if (component) {
                this.context[id] = component.value;
            } else {
                let func_obj = SoftResource_Function.get_instance(id);
                if (func_obj) {
                    this.context[id] = func_obj.code.value;
                }
            }
        }
        
        try {
            this.script.runInNewContext(this.context, {timeout: 3000});
        }
        catch (e) {
            cascade.log_error("ERROR: function " + this.name + ": " + e.toString());
            return;
        }

        _.each(this.context, function (value, id) {
            let component = cascade.components.all_current[id];
            if (component && !component.read_only) {
                if (component.value != value) {
                    component.value = value;
                }
            }
        });
    }
};



//////////////////////////////////////////////////////////////////////////////
// Soft-Hard resources -- SoftResource wrappers for hard resources
// Base class
//////////////////////////////////////////////////////////////////////////////
function SoftResource_HR(cascade, name) {
    var self = this;

    this.cascade = cascade;  // This is probably bad idea, but need it for attach_HR()
    this.name = name;
    this.description = name_to_description(this.name);
    this.HR_assignment = undefined;

    this.HR_selector = cascade.create_component(
        {
            id: name + "_HR",
            name: this.description + "      Resource Selector",
            group: HR_ASSIGNMENT_GROUP,
            display_order: next_display_order(),
            class: "hard_resource_selector",
            type: cascade.TYPES.OPTIONS,
            info: {options: this.HR_options},
            persist: true,
        });

    this.HR_selector.on("value_updated",
        function() {self.on_HR_selector_update();} );

    if (!this.HR_names_component) {
        cascade.components.require_component(this.HR_names_component_name,
            function(names_component) {
                self.HR_names_component = names_component;
                self.on_HR_names_update();
                self.HR_names_component.on("update_value",
                    function() {self.on_HR_names_update();});
                // eslint-disable-next-line no-self-assign
                self.HR_selector.value = self.HR_selector.value;
            });
    }
    this.instances_of_type[this.name] = this;
}

// Utility to initialize SoftResource_HR subclass prototypes.
// Called once before constructor is executed.
var create_SoftResource_HR_prototype = function(HR_type, class_prototype, no_HR) {
    // create a subclass prototype object linked to the superclass.
    if (!class_prototype) {
        class_prototype = SoftResource_HR.prototype;
    }
    var prototype = Object.create(class_prototype);
    //  Set class properties
    if (!no_HR) {
        prototype._HR_names_component_name = HR_type + "_HR_names";
        prototype._HR_names_component = undefined;
        prototype._HR_options = [];
        prototype._HR_assigned = [];
    }
    prototype._instances_of_type = {};

    return prototype;
};

// called from subclass constructor to create getters/setters for class properties.
SoftResource_HR.prototype.init_subclass_properties = function(constructor, base_constructor) {
    if (this.instances_of_type) return;  // a subclass has the properties
    if (!base_constructor) {
        base_constructor = constructor;
    }
    Object.defineProperties(this,
        {
            HR_names_component_name: {
                get() { return base_constructor.prototype._HR_names_component_name; },
            },
            HR_names_component: {
                get() { return base_constructor.prototype._HR_names_component; },
                set(value) { base_constructor.prototype._HR_names_component = value; }
            },
            HR_assigned: {
                get() { return base_constructor.prototype._HR_assigned; },
            },
            HR_options: {
                get() { return base_constructor.prototype._HR_options; },
            },
            instances_of_type: {
                get() { return constructor.prototype._instances_of_type; },
            }
        });
};

// Methods for maintaining properties == this keeps the options list current
// with the unassigned and available HR options.
// Events that change the lists:
//      1. Assignment or deassignment of hard resource to a soft resource.
//         (value update on HR_selector);
//      2. Change in the list of hard resources ( value update on HR_type_names);
//      3. Soft resource is deleted (implied unassign of a value).


SoftResource_HR.prototype.assign_HR = function(HR_name) {
    if (this.HR_assignment === HR_name) return;
    if (this.HR_assignment) {
        this.unassign_HR();
    }

    if (remove_name_from_list(this.HR_options, HR_name)) {
        add_name_to_list(this.HR_assigned, HR_name);
    }
    this.attach_HR(HR_name);
    return HR_name;
};

SoftResource_HR.prototype.unassign_HR = function(HR_name) {
    if (HR_name && HR_name != this.HR_assignment) return;
    var prior_assignment = this.detach_HR();
    if (!prior_assignment) return;

    if (!remove_name_from_list(this.HR_assigned, prior_assignment)) return;
    add_name_to_list(this.HR_options, prior_assignment, true);
    return prior_assignment;
};

SoftResource_HR.prototype.update_selector_options = function() {
    if (!this.HR_assignment) {
        this.HR_selector.info = {options: this.HR_options};
    }
    else {
        let new_options = this.HR_options.slice();
        new_options.push(this.HR_assignment);
        new_options.sort();
        this.HR_selector.info = {options: new_options};
    }
};

SoftResource_HR.prototype.on_HR_selector_update = function() {
    var new_HR = this.HR_selector.value;
    if (new_HR === this.HR_assignment) return;
    if (this.HR_assignment) {
        this.unassign_HR();
    }
    if (new_HR) {
        this.assign_HR(new_HR);
    }
    _.each(this.instances_of_type,
        function(sr) {sr.update_selector_options();});
};

SoftResource_HR.prototype.on_HR_names_update = function() {
    var HR_name_set = get_name_set(this.HR_names_component.value);
    var assigned_set = new Set(this.HR_assigned);
    var options_set = new Set(this.HR_options);

    // add new names
    for (let name of HR_name_set) {
        if (!assigned_set.has(name) && !options_set.has(name)) {
            add_name_to_list(this.HR_options, name, true);
        }
    }

    // remove deleted names
    for (let name of options_set) {
        if (!HR_name_set.has(name)) {
            remove_name_from_list(this.HR_options, name);
        }
    }
    for (let name of assigned_set) {
        if (!HR_name_set.has(name)) {
            remove_name_from_list(this.HR_assigned, name);
            // detach this HR from SoftResource using it.
            for (let soft_resource of this.instances_of_type) {
                soft_resource.unassign_HR(name);
            }
        }
    }
    this.HR_selector.info = {options: this.HR_options};
};

//////////////////////
// BIT_OUT          //
//////////////////////

function SoftResource_BIT_OUT(cascade, name) {
    this.init_subclass_properties(SoftResource_BIT_OUT);
    SoftResource_HR.call(this, cascade, name);

    // components for this SR
    this.HR_port_value = undefined;
    this.bit_value = undefined;
}

// Link prototype to base class
SoftResource_BIT_OUT.prototype = create_SoftResource_HR_prototype("BIT_OUT");

// add psuedo class methods (not inherited by subclasses).
SoftResource_BIT_OUT.get_instances = function() {
    return SoftResource_BIT_OUT.prototype._instances_of_type;
};
SoftResource_BIT_OUT.get_instance = function(name) {
    return SoftResource_BIT_OUT.prototype._instances_of_type[name];
};

// Add type instance methods
SoftResource_BIT_OUT.prototype.attach_HR = function(HR_name) {
    var self = this;
    if (!this.bit_value) {
        this.bit_value = this.cascade.create_component({
            id: this.name,
            name: this.description,
            group: PROCESS_CONTROL_GROUP,
            display_order: next_display_order(),
            class: "bit output",
            type: this.cascade.TYPES.BOOLEAN,
            value: false
        });
    }
    this.bit_value.value = false;
    this.cascade.components.require_component(HR_name,
        function(component) {
            self.HR_port_value = component;
            set_driving_components(self.bit_value, self.HR_port_value);
        });
    this.HR_assignment = HR_name;
};

SoftResource_BIT_OUT.prototype.detach_HR = function() {
    this.bit_value.value = false;
    unset_driving_components(this.bit_value, this.HR_port_value);

    this.HR_port_value = undefined;
    var prior_assignment = this.HR_assignment;
    this.HR_assignment =  undefined;
    return prior_assignment;
};

SoftResource_BIT_OUT.prototype.reset_bit_out = function() {
    if (this.bit_value) {
        this.bit_value.value = false;
    }
};

//////////////////////
// RELAY            //
//////////////////////

function SoftResource_RELAY(cascade, name) {
    this.init_subclass_properties(SoftResource_RELAY);
    SoftResource_HR.call(this, cascade, name);

    // components for this SR
    this.HR_enable = undefined;
    this.RELAY_enable = undefined;
}

// Link prototype to base class
SoftResource_RELAY.prototype = create_SoftResource_HR_prototype("RELAY");

// add psuedo class methods (not inherited by subclasses).
SoftResource_RELAY.get_instances = function() {
    return SoftResource_RELAY.prototype._instances_of_type;
};
SoftResource_RELAY.get_instance = function(name) {
    return SoftResource_RELAY.prototype._instances_of_type[name];
};

// Add type instance methods
SoftResource_RELAY.prototype.attach_HR = function(HR_name) {
    var self = this;
    if (!this.RELAY_enable) {
        this.RELAY_enable = this.cascade.create_component({
            id: this.name + "_enable",
            name: this.description + " Enable",
            group: PROCESS_CONTROL_GROUP,
            display_order: next_display_order(),
            class: "sr_relay_enable",
            type: this.cascade.TYPES.BOOLEAN,
            value: false
        });
    }
    this.RELAY_enable.value = false;
    this.cascade.components.require_component(HR_name,
        function(component) {
            self.HR_enable = component;
            set_driving_components(self.RELAY_enable, self.HR_enable);
        });
    this.HR_assignment = HR_name;
};

SoftResource_RELAY.prototype.detach_HR = function() {
    this.RELAY_enable.value = false;
    unset_driving_components(this.RELAY_enable, this.HR_enable);

    this.HR_enable = undefined;
    var prior_assignment = this.HR_assignment;
    this.HR_assignment =  undefined;
    return prior_assignment;
};

SoftResource_RELAY.prototype.on_HR_selector_update = function() {
    SoftResource_HR.prototype.on_HR_selector_update.call(this);
    _.each(SoftResource_DUTYCYCLE_RELAY.get_instances(),
        function(sr) {sr.update_selector_options();});
};

SoftResource_RELAY.prototype.reset_relay = function() {
    if (this.RELAY_enable) {
        this.RELAY_enable.value = false;
    }
};

//////////////////////
// DUTYCYCLE_RELAY  //
//////////////////////

// NOTE:  This is a subclass of a subclass of SoftResource_HR.

var DEFAULT_DCR_CYCLE_LENGTH = 20;

function SoftResource_DUTYCYCLE_RELAY(cascade, name) {
    // install properties before constructing base class
    this.init_subclass_properties(SoftResource_DUTYCYCLE_RELAY, SoftResource_RELAY);
    SoftResource_RELAY.call(this, cascade, name);

    this.DCR_cycle_enable = undefined;
    this.DCR_cycle_length = undefined;
    this.DCR_on_percent = undefined;

    this.timer = undefined;

}

// link subclass prototype to super class
SoftResource_DUTYCYCLE_RELAY.prototype = create_SoftResource_HR_prototype(
    "DUTYCYCLE_RELAY", SoftResource_RELAY.prototype, true);

// add psuedo class methods (not inherited by subclasses).
SoftResource_DUTYCYCLE_RELAY.get_instances = function() {
    return SoftResource_DUTYCYCLE_RELAY.prototype._instances_of_type;
};
SoftResource_DUTYCYCLE_RELAY.get_instance = function(name) {
    return SoftResource_DUTYCYCLE_RELAY.prototype._instances_of_type[name];
};

// Add type instance methods
SoftResource_DUTYCYCLE_RELAY.prototype.attach_HR = function(HR_name) {
    var self = this;
    SoftResource_RELAY.prototype.attach_HR.call(this, HR_name);

    if (!this.DCR_cycle_enable) {
        this.DCR_cycle_enable = this.cascade.create_component({
            id: this.name + "_cycle_enable",
            name: this.description + " Cycle Enable",
            group: PROCESS_CONTROL_GROUP,
            display_order: next_display_order(),
            class: "dcr_enable",
            type: this.cascade.TYPES.BOOLEAN,
            units: "seconds",
            value: false
        });
        this.DCR_cycle_enable.on("value_updated", function(){
            self.stop_timer();
            if(self.DCR_cycle_enable.value)
            {
                self.process_duty_cycle();
            }
        });

        this.DCR_cycle_length = this.cascade.create_component({
            id: this.name + "_cycle_length",
            name: this.description + " Cycle Length",
            group: PROCESS_CONTROL_GROUP,
            display_order: next_display_order(),
            class: "dcr_cycle_length",
            type: this.cascade.TYPES.NUMBER,
            units: "seconds",
            persist: true,
        });
        if (this.DCR_cycle_length.value) {
            this.DCR_cycle_length.value = this.DCR_cycle_length.value;
        } else {
            this.DCR_cycle_length.value = DEFAULT_DCR_CYCLE_LENGTH;
        }

        this.DCR_cycle_length.on("value_updated", function(){
            self.stop_timer();
            if(self.DCR_cycle_enable.value)
            {
                self.process_duty_cycle();
            }
        });

        this.DCR_on_percent = this.cascade.create_component({
            id: this.name + "_on_percent",
            name: this.description + " On Percent",
            group: PROCESS_CONTROL_GROUP,
            class: "drc_on_percent",
            display_order: next_display_order(),
            type: this.cascade.TYPES.NUMBER,
            units: this.cascade.UNITS.PERCENTAGE,
            value: 0
        });
    }

    this.process_duty_cycle();
};

SoftResource_DUTYCYCLE_RELAY.prototype.detach_HR = function(HR_name) {
    this.reset_dcr();
    return SoftResource_RELAY.prototype.detach_HR.call(this, HR_name);
};

SoftResource_DUTYCYCLE_RELAY.prototype.on_HR_selector_update = function() {
    SoftResource_HR.prototype.on_HR_selector_update.call(this);
    _.each(SoftResource_RELAY.get_instances(),
        function(sr) {sr.update_selector_options();});
};

SoftResource_DUTYCYCLE_RELAY.prototype.reset_dcr = function() {
    if (this.DCR_cycle_enable) {
        this.DCR_cycle_enable.value = false;
        this.DCR_on_percent.value = 0;
        this.stop_timer();
    }
    this.reset_relay();
};

SoftResource_DUTYCYCLE_RELAY.prototype.process_duty_cycle = function() {

    var self = this;

    if (this.DCR_cycle_enable.value === false)
    {
        return;
    }

    var cycle_time_in_ms = this.DCR_cycle_length.value * 1000.0;

    // If anything less than 1 second, let's ignore it
    if(cycle_time_in_ms <= 1000)
    {
        return;
    }

    var ms_on = (this.DCR_on_percent.value / 100.0) * cycle_time_in_ms;
    var ms_off = cycle_time_in_ms - ms_on;

    if(ms_on > 0 && this.RELAY_enable)
    {
        this.RELAY_enable.value = true; // Start our cycle
    }

    this.timer = setTimeout(function(){

        if(ms_off > 0 && self.RELAY_enable)
        {
            self.RELAY_enable.value = false; // Stop our cycle
        }

        self.timer = setTimeout(function() {
            self.process_duty_cycle(); // Start all over again
        }, ms_off);

    }, ms_on);
};

SoftResource_DUTYCYCLE_RELAY.prototype.stop_timer = function() {
    if(this.timer)
    {
        clearTimeout(this.timer);
        delete this.timer;
    }

    if(this.RELAY_enable)
    {
        this.RELAY_enable.value = false;
    }
};


//////////////////////
// DAC              //
//////////////////////
function SoftResource_DAC(cascade, name) {

    this.init_subclass_properties(SoftResource_DAC);
    SoftResource_HR.call(this, cascade, name);

    this.HR_enable = undefined;
    this.DAC_enable = undefined;
    this.HR_output = undefined;
    this.DAC_output = undefined;
}

// Link prototype to base class
SoftResource_DAC.prototype = create_SoftResource_HR_prototype("DAC");

// add psuedo class methods (not inherited by subclasses).
SoftResource_DAC.get_instances = function() {
    return SoftResource_DAC.prototype._instances_of_type;
};
SoftResource_DAC.get_instance = function(name) {
    return SoftResource_DAC.prototype._instances_of_type[name];
};


// Add type instance methods
SoftResource_DAC.prototype.attach_HR = function(HR_name) {
    var self = this;
    if (!this.DAC_enable) {
        this.DAC_enable = this.cascade.create_component({
            id: this.name + "_enable",
            name: this.description + " Enable",
            group: PROCESS_CONTROL_GROUP,
            display_order: next_display_order(),
            class: "dac_enable",
            type: this.cascade.TYPES.BOOLEAN,
            value: false
        });

        this.DAC_output = this.cascade.create_component({
            id: this.name + "_output",
            name: this.description + " Output",
            group: PROCESS_CONTROL_GROUP,
            display_order: next_display_order(),
            class: "dac_output",
            type: this.cascade.TYPES.NUMBER,
            units: this.cascade.UNITS.PERCENTAGE,
            value: 0
        });
    }

    this.DAC_enable.value = false;
    this.DAC_output.value = 0;

    this.cascade.components.require_component(HR_name + "_enable",
        function(component) {
            self.HR_enable = component;
            set_driving_components(self.DAC_enable, self.HR_enable);
        });
    this.cascade.components.require_component(HR_name + "_output",
        function(component) {
            self.HR_output = component;
            set_driving_components(self.DAC_output, self.HR_output);
        });
    this.HR_assignment = HR_name;
};

SoftResource_DAC.prototype.detach_HR = function() {
    this.reset_dac();
    if (this.HR_enable) {
        unset_driving_components(this.DAC_enable, this.HR_enable);
    }
    if (this.HR_output) {
        unset_driving_components(this.DAC_output, this.HR_output);
    }
    this.HR_enable = undefined;
    this.HR_output = undefined;

    var prior_assignment = this.HR_assignment;
    this.HR_assignment = undefined;
    return prior_assignment;
};

SoftResource_DAC.prototype.reset_dac = function() {
    if (this.DAC_enable) {
        this.DAC_enable.value = false;
        this.DAC_output.value = 0;
    }
};

//////////////////////
// STEPPER          //
//////////////////////
function SoftResource_STEPPER(cascade, name) {

    this.init_subclass_properties(SoftResource_STEPPER);
    SoftResource_HR.call(this, cascade, name);

    this.HR_enable = undefined;
    this.STEPPER_enable = undefined;
    this.HR_velocity = undefined;
    this.STEPPER_velocity = undefined;
}

// Link prototype to base class
SoftResource_STEPPER.prototype = create_SoftResource_HR_prototype("STEPPER");

// add psuedo class methods (not inherited by subclasses).
SoftResource_STEPPER.get_instances = function() {
    return SoftResource_STEPPER.prototype._instances_of_type;
};
SoftResource_STEPPER.get_instance = function(name) {
    return SoftResource_STEPPER.prototype._instances_of_type[name];
};


// Add type instance methods
SoftResource_STEPPER.prototype.attach_HR = function(HR_name) {
    var self = this;
    if (!this.STEPPER_enable) {
        this.STEPPER_enable = this.cascade.create_component({
            id: this.name + "_enable",
            name: this.description + " Enable",
            group: PROCESS_CONTROL_GROUP,
            display_order: next_display_order(),
            class: "stepper_enable",
            type: this.cascade.TYPES.BOOLEAN,
            value: false
        });

        this.STEPPER_velocity = this.cascade.create_component({
            id: this.name + "_velocity",
            name: this.description + " Velocity",
            group: PROCESS_CONTROL_GROUP,
            display_order: next_display_order(),
            class: "stepper_velocity",
            type: this.cascade.TYPES.NUMBER,
            units: this.cascade.UNITS.PERCENTAGE,
            value: 0
        });
    }
    this.STEPPER_enable.value = false;
    this.STEPPER_velocity.value = 0;

    this.cascade.components.require_component(HR_name + "_enable",
        function(component) {
            self.HR_enable = component;
            set_driving_components(self.STEPPER_enable, self.HR_enable);
        });
    this.cascade.components.require_component(HR_name + "_velocity",
        function(component) {
            self.HR_velocity = component;
            set_driving_components(self.STEPPER_velocity, self.HR_velocity);
        });
    this.HR_assignment = HR_name;
};

SoftResource_STEPPER.prototype.detach_HR = function() {
    this.reset_stepper();
    if (this.HR_enable) {
        unset_driving_components(this.STEPPER_enable, this.HR_enable);
    }
    if (this.HR_velocity) {
        unset_driving_components(this.STEPPER_velocity, this.HR_velocity);
    }
    this.HR_enable = undefined;
    this.HR_velocity = undefined;

    var prior_assignment = this.HR_assignment;
    this.HR_assignment = undefined;
    return prior_assignment;
};

SoftResource_STEPPER.prototype.reset_stepper = function() {
    if (this.STEPPER_enable) {
        this.STEPPER_enable.value = false;
        this.STEPPER_velocity.value = 0;
    }
};

//////////////////////
// BIT_IN           //
//////////////////////
function SoftResource_BIT_IN(cascade, name) {
    this.init_subclass_properties(SoftResource_BIT_IN);
    SoftResource_HR.call(this, cascade, name);
    this.HR_port_value = undefined;
    this.bit_value = undefined;
}

// add psuedo class methods (not inherited by subclasses).
SoftResource_BIT_IN.get_instances = function() {
    return SoftResource_BIT_IN.prototype._instances_of_type;
};
SoftResource_BIT_IN.get_instance = function(name) {
    return SoftResource_BIT_IN.prototype._instances_of_type[name];
};

SoftResource_BIT_IN.prototype = create_SoftResource_HR_prototype("BIT_IN");

SoftResource_BIT_IN.prototype.attach_HR = function(HR_name) {
    var self = this;
    if (!this.bit_value) {
        this.bit_value = this.cascade.create_component({
            id: this.name,
            name: this.description,
            group: PROCESS_SENSOR_GROUP,
            display_order: next_display_order(),
            class: "bit input",
            read_only: true,
            type: this.cascade.TYPES.BOOLEAN,
            units: this.cascade.UNITS.NONE,
        });
    }

    this.cascade.components.require_component(HR_name,
        function(component) {
            self.HR_port_value = component;
            set_driving_components(self.HR_port_value, self.bit_value);
        });
    this.HR_assignment = HR_name;
};

SoftResource_BIT_IN.prototype.detach_HR = function() { 
    if (this.HR_port_value) {
        unset_driving_components(this.HR_port_value, this.bit_value);
    }
    this.HR_port_value = undefined;
    this.bit_value.value = 0;

    var prior_assignment = this.HR_assignment;
    this.HR_assignment = undefined;
    return prior_assignment;
};

SoftResource_BIT_IN.prototype.get_bit_value = function() {
    if (this.bit_value) {
        return this.bit_value.value;
    }
    return 0;
};

//////////////////////
// DISTANCE            //
//////////////////////
function SoftResource_DISTANCE(cascade, name) {
    this.init_subclass_properties(SoftResource_DISTANCE);
    SoftResource_HR.call(this, cascade, name);
    this.HR_distance = undefined;
    this.distance = undefined;
}

// add psuedo class methods (not inherited by subclasses).
SoftResource_DISTANCE.get_instances = function() {
    return SoftResource_DISTANCE.prototype._instances_of_type;
};
SoftResource_DISTANCE.get_instance = function(name) {
    return SoftResource_DISTANCE.prototype._instances_of_type[name];
};

SoftResource_DISTANCE.prototype = create_SoftResource_HR_prototype("DISTANCE");

SoftResource_DISTANCE.prototype.attach_HR = function(HR_name) {
    var self = this;
    if (!this.distance) {
        this.distance = this.cascade.create_component({
            id: this.name,
            name: this.description + " Distance (mm)",
            group: PROCESS_SENSOR_GROUP,
            display_order: next_display_order(),
            class: "distance",
            read_only: true,
            type: this.cascade.TYPES.NUMBER,
            value: 0
        });
    }

    this.cascade.components.require_component(HR_name + "_distance",
        function(component) {
            self.HR_distance = component;
            set_driving_components(self.HR_distance, self.distance);
        });
    this.HR_assignment = HR_name;
};

SoftResource_DISTANCE.prototype.detach_HR = function() { 
    if (this.HR_distance) {
        unset_driving_components(this.HR_distance, this.distance);
    }
    this.HR_distance = undefined;
    this.distance.value = 0;

    var prior_assignment = this.HR_assignment;
    this.HR_assignment = undefined;
    return prior_assignment;
};

SoftResource_DISTANCE.prototype.get_distance = function() {
    if (this.distance) {
        return this.distance.value;
    }
    return 0;
};


//////////////////////
// OW_PROBE         //
//////////////////////

// Temperature probe classes
function SoftResource_OW_PROBE(cascade, name) {
    this.init_subclass_properties(SoftResource_OW_PROBE);
    SoftResource_HR.call(this, cascade, name);
    probe_constructor(this);
}

// add psuedo class methods (not inherited by subclasses).
SoftResource_OW_PROBE.get_instances = function() {
    return SoftResource_OW_PROBE.prototype._instances_of_type;
};
SoftResource_OW_PROBE.get_instance = function(name) {
    return SoftResource_OW_PROBE.prototype._instances_of_type[name];
};

SoftResource_OW_PROBE.prototype = create_SoftResource_HR_prototype("OW_PROBE");
SoftResource_OW_PROBE.prototype.attach_HR = function(HR_name) { probe_attach_HR(this, HR_name);};
SoftResource_OW_PROBE.prototype.detach_HR = function() { return probe_detach_HR(this);};
SoftResource_OW_PROBE.prototype.get_temperature = function() { return probe_get_temperature(this);};


//////////////////////
// TC_PROBE         //
//////////////////////

function SoftResource_TC_PROBE(cascade, name) {
    this.init_subclass_properties(SoftResource_TC_PROBE);
    SoftResource_HR.call(this, cascade, name);
    probe_constructor(this, cascade, name);
}

// add psuedo class methods (not inherited by subclasses).
SoftResource_TC_PROBE.get_instances = function() {
    return SoftResource_TC_PROBE.prototype._instances_of_type;
};
SoftResource_TC_PROBE.get_instance = function(name) {
    return SoftResource_TC_PROBE.prototype._instances_of_type[name];
};

SoftResource_TC_PROBE.prototype = create_SoftResource_HR_prototype("TC_PROBE");
SoftResource_TC_PROBE.prototype.attach_HR = function(HR_name) { probe_attach_HR(this, HR_name);};
SoftResource_TC_PROBE.prototype.detach_HR = function() { return probe_detach_HR(this);};
SoftResource_TC_PROBE.prototype.get_temperature = function() { return probe_get_temperature(this);};

//////////////////////
// PTC_PROBE        //
//////////////////////

function SoftResource_PTC_PROBE(cascade, name) {
    this.init_subclass_properties(SoftResource_PTC_PROBE);
    SoftResource_HR.call(this, cascade, name);
    probe_constructor(this, cascade, name);
}

// add psuedo class methods (not inherited by subclasses).
SoftResource_PTC_PROBE.get_instances = function() {
    return SoftResource_PTC_PROBE.prototype._instances_of_type;
};
SoftResource_PTC_PROBE.get_instance = function(name) {
    return SoftResource_PTC_PROBE.prototype._instances_of_type[name];
};

SoftResource_PTC_PROBE.prototype = create_SoftResource_HR_prototype("PTC_PROBE");
SoftResource_PTC_PROBE.prototype.attach_HR = function(HR_name) { probe_attach_HR(this, HR_name);};
SoftResource_PTC_PROBE.prototype.detach_HR = function() { return probe_detach_HR(this);};
SoftResource_PTC_PROBE.prototype.get_temperature = function() { return probe_get_temperature(this);};

//////////////////////
// TEMP_PROBE       //
//////////////////////

// The TEMP_PROBE combines all hard resource temperature probe types.
function SoftResource_TEMP_PROBE(cascade, name) {
    this.init_subclass_properties(SoftResource_TEMP_PROBE);
    SoftResource_HR.call(this, cascade, name);
    probe_constructor(this, cascade, name);
}

// add psuedo class methods (not inherited by subclasses).
SoftResource_TEMP_PROBE.get_instances = function() {
    return SoftResource_TEMP_PROBE.prototype._instances_of_type;
};
SoftResource_TEMP_PROBE.get_instance = function(name) {
    return SoftResource_TEMP_PROBE.prototype._instances_of_type[name];
};

SoftResource_TEMP_PROBE.prototype = create_SoftResource_HR_prototype("TEMP_PROBE");
SoftResource_TEMP_PROBE.prototype.attach_HR = function(HR_name) {probe_attach_HR(this, HR_name);};
SoftResource_TEMP_PROBE.prototype.detach_HR = function() { return probe_detach_HR(this);};
SoftResource_TEMP_PROBE.prototype.get_temperature = function() { return probe_get_temperature(this);};

// Probe types are identical in instance properties, but need
// separate class properties.  The following functions are shared by
// the probe classes.

var probe_constructor = function(this_probe) {
    this_probe.HR_calibrated_temp = undefined;
    this_probe.probe_temperature = undefined;
};

var probe_attach_HR = function(this_probe, HR_name) {
    if (!this_probe.probe_temperature) {
        this_probe.probe_temperature = this_probe.cascade.create_component({
            id: this_probe.name,
            name: this_probe.description + " (calibrated)",
            group: PROCESS_SENSOR_GROUP,
            display_order: next_display_order(),
            class: "sr_probe",
            read_only: true,
            type: this_probe.cascade.TYPES.NUMBER,
            units: this_probe.cascade.UNITS.C,
            value: 0
        });
    }

    this_probe.cascade.components.require_component(HR_name + "_calibrated",
        function(component) {
            this_probe.HR_calibrated_temp = component;
            set_driving_components(this_probe.HR_calibrated_temp, this_probe.probe_temperature);
        });
    this_probe.HR_assignment = HR_name;
};

var probe_detach_HR = function(this_probe) {
    if (this_probe.HR_calibrated_temp) {
        unset_driving_components(this_probe.HR_calibrated_temp, this_probe.probe_temperature);
    }
    this_probe.HR_calibrated_temp = undefined;
    this_probe.probe_temperature.value = 0;

    var prior_assignment = this_probe.HR_assignment;
    this_probe.HR_assignment = undefined;
    return prior_assignment;
};

var probe_get_temperature = function(this_probe) {
    if (this_probe.probe_temperature) {
        return this_probe.probe_temperature.value;
    }
    return 0;
};
