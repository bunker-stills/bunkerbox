// This module contains functionality shared between different interfaces.
// Currently this includes tf_redbrick and stillsim.

const _ = require("underscore");

var cascade;  // copy of cascade reference
module.exports.setup_utils = function(cascade_) {
    cascade = cascade_;
};

// Loop logging
var loop_count = 0;
var start_time = Date.now();
var rpt_time = start_time;

module.exports.log_cycle = function () {
    loop_count += 1;
    if (loop_count%600 == 0) {
        let dt = Date.now() - rpt_time;
        rpt_time += dt;
        let et = rpt_time - start_time;
        let d = Math.floor(et/(3600000*24));
        let h = Math.floor(et%(3600000*24)/3600000);
        let m = Math.floor(et%3600000/60000);
        let s = et%60000/1000;
        cascade.log_info("Cycles: "+loop_count +
                         "; Elapsed time: "+d+" days and "+h+":"+m+":"+s+
                         "; 600 cycles in the last "+dt/1000+" seconds.");
    }
};

// Display orders:
var global_display_order = 100;

module.exports.next_display_order = function(skip) {
    let rtn = global_display_order;
    global_display_order += skip || 1;
    return rtn;
};

// Max temp and overtemp:
var max_temp;  // max value of all temp probes (component)
var failsafe_temp;  // Overtemp limit for all temp probes. (component)
var last_logged_max_temp = 0;

module.exports.setup_overtemp = function(group) {
    // Request failsafe_temp component.
    cascade.components.require_component("failsafe_temp",
        function(component) {failsafe_temp = component;});

    // Create max_temp component used by stills overtemp shutdown feature.
    max_temp = cascade.create_component({
        id: "max_temp",
        name: "Max Temperature",
        description: "Peak measured temperature",
        group: group,
        display_order: 1000,
        units: "C",
        value: 0,
    });

};

module.exports.check_max_temp = function(new_temp, probe_name) {
    let Tmax = max_temp.value;
    if (new_temp > Tmax) {
        /* To filter out data errors, we reject values greater than twice
        ** the current max_temp value.  This does not apply to temp values
        ** less than 100C.
        */
        if (new_temp < 100 || new_temp < 2*Tmax) {
            if (new_temp - last_logged_max_temp >= 1
                || (!_.isUndefined(failsafe_temp) && failsafe_temp.value <= new_temp)) {
                last_logged_max_temp = new_temp;
                cascade.log_info("Set max_temp to "
                    + new_temp + "C from " + probe_name + ".");
            }
            max_temp.value = new_temp;
        } else {
            cascade.log_info("Reject max_temp of "
                + new_temp + "C from " + probe_name + ".");
            return false;  /* temperature was rejected */
        }
    }
    return true;
};

//Resourece lists
const RESOURCE_NAMES_GROUP = "99  Hard Resources";
const HR_LISTS_DISPLAY_BASE = 20000;

module.exports.update_hard_resource_list_component = function(cascade, id, list, group) {
    // id is the name of the list and component
    // list is the current complete list of resource names
    var value = list.join(" ");
    var component = cascade.components.all_current[id];

    if (!component) {
        var type;
        if (value.length > 32) {
            type = cascade.TYPES.BIG_TEXT;
        }
        else {
            type = cascade.TYPES.TEXT;
        }

        cascade.create_component({
            id: id,
            group: group || RESOURCE_NAMES_GROUP,
            display_order: HR_LISTS_DISPLAY_BASE + module.exports.next_display_order(),
            read_only: true,
            type: type,
            value: value
        });
    }
    else {
        component.value = value;
    }
};