const got = require("got");
const utils = require("./utils");

var SIM_URL = process.env.SIM_URL || "http://127.0.0.1:3300/";

var SIM_GROUP = "01 SIM STUFF";   // meta, sim_value, sim_control
var SENSORS_GROUP = "97  Model Sensors";
var PROCESS_CONTROLS_GROUP = "98  Model Controls";
var RESOURCE_NAMES_GROUP = "99  Model Resources";

var latest_status;  // returned json object
var model_selector; // local component
var current_run;    // local component
var current_state;  // local component
var run_mode;       // component from stills.js

var temp_probe_names = [];
var temp_probes = {};
var dac_names = [];
var dacs = {};

function do_request(action, body) {
    // 'action' is one of 'read_status', 'load', 'unload', 'run', 'stop
    // 'update'.  'body' is used for 'load' and 'update'.
    // returns a promise
    var options = {
        baseUrl:SIM_URL,
        json:true,
        timeout:15000,
        retries: 1
    };
    if (body) {
        options.body = body;
    }
    return new Promise(function(resolve, reject) {
        const got_promise = got(action, options);
        got_promise.then(
            function(response) {
                let result = response.body;
                latest_status = result;
                if (result.meta.response_code != 200) {
                    reject(result.meta.msg);
                } else {
                    current_state.value = result.meta.state;
                    current_run.value = result.meta.current_run;
                    resolve(result);
                }
            },
            function(err) {
                reject(err);
            }
        );
    });
}

function load_model(cascade) {
    if (current_state == "unloaded") {
        // load model
        do_request("load", {"modelnm": model_selector.value})
            .then(function(result) {
                model_selector.info.options = [model_selector.value];
                run_mode.value = "STOP";

                // get list of controls and probes from current status
                get_probes_and_controls();
            })
            .catch(function(err) {
                cascade.log_error(new Error("Sim model load error: " + err));
            });
    } else {
        let current_model = current_run.slice(0,-9);
        model_selector.info.options = [current_model];
        if (model_selector.value != current_model) {
            model_selector.value = current_model;
        }

        if (current_state == "running") {
            run_mode.value = "RUN";
        } else {
            run_mode.value = "STOP";
        }
    }
}

function execute_run_mode(cascade) {
    switch (run_mode.value.toUpperCase()) {
        case "UNLOAD": {
            if (current_state == "unloaded") break;

            if (current_state === "running") {
                do_request("stop")
                    .catch(function(err) {
                        cascade.log_error(new Error("Stopping on run_mode UNLOAD: " + err));
                    });
                run_mode.value = "STOP";
            }
            do_request("unload")
                .catch(function(err) {
                    cascade.log_error(new Error("On run_mode UNLOAD: " + err));
                });
            break;
        }
        case "STOP": {
            if (current_state === "loaded") break;
            if (current_state === "unloaded") {
                // return state to UNLOAD; use model selector to get to loaded
                run_mode.value = "UNLOAD";
            }

            do_request("stop")
                .catch(function(err) {
                    cascade.log_error(new Error("On run_mode STOP: " + err));
                });
            break;
        }
        case "RUN": {
            if (current_state === "running") break;
            if (current_state === "unloaded") {
                // return state to UNLOAD; use model selector to get to loaded
                run_mode.value = "UNLOAD";
            }

            do_request("run")
                .catch(function(err) {
                    cascade.log_error(new Error("On run_mode RUN: " + err));
                });
            break;
        }
        default: {
            cascade.log_error(new Error("Unknown run_mode " + run_mode.value));
            break;
        }
    }
}

function KtoC(K) {if (K) return K-273.15;}
function CtoK(C) {if (C) return C+273.15;}
function mbarToPa(mbar) {if (mbar) return mbar*100;}
function PaToMbar(Pa) {if (Pa) return Pa*0.01;}
function gphToCmps(gph) {if (gph) return gph*1.0515e-6;}
function cmpsToGph(cmps) {if (cmps) return cmps*9.5102e5;}

function get_probes_and_controls(cascade) {

    // simulator values to control and monitor simulation process
    for (let sim_val of latest_status.sim_value) {
        sim_val["group"] = SIM_GROUP;
        sim_val["display_order"] = utils.next_display_order();
        cascade.create_component(sim_val);
    }
    for (let sim_ctl of latest_status.sim_control) {
        sim_ctl["group"] = SIM_GROUP;
        sim_ctl["display_order"] = utils.next_display_order();
        if (sim_ctl.units == "K") {
            sim_ctl.units = "C";
            sim_ctl.value = KtoC(sim_ctl.value);
        }
        if (sim_ctl.name == "Ambient_pres") {
            sim_ctl.name = "barometer";
            sim_ctl.units = "mbar";
            sim_ctl.value = PaToMbar(sim_ctl.value);
        }
        let component = cascade.create_component(sim_ctl);
        component.on("value_updated",
            function() { update_control(component, "sim_control"); });
    }

    // sensors and controls on the still model
    for (let probe of latest_status.model_probe) {
        if (probe.name.startswith("ambient")) continue;
        if (probe.units != "K") continue;
        probe.units = "C";
        probe.value = KtoC(probe.value);
        probe.group = SENSORS_GROUP;
        probe.display_order = utils.next_display_order();
        let temp_probe = cascade.create_component(probe);

        setup_temp_probe(temp_probe);
    }
    utils.update_hard_resource_list_component(cascade,
        "TEMP_PROBE_HR_names", temp_probe_names.sort());

    for (let control of latest_status.model_control) {
        if (control.type == "VECTOR") continue;

        if (control.units == "K") {
            control.units = "C";
            control.value = KtoC(control.value);
        }
        if (control.units == "m^3/s") {
            control.units = "gph";
            control.value = cmpsToGph(control.value);
        }
        if (control.units == "0=1") {
            control.units = "%";
            control.value = control.value*100;
        }

        control.group = PROCESS_CONTROLS_GROUP;
        control.display_order = utils.next_display_order();
        let dac = cascade.create_component(control);

        setup_dac(dac);
    }
    utils.update_hard_resource_list_component(cascade,
        "DAC_HR_names", dac_names.sort());


    // DONE Setup event handlers to transfer sim and model control commands.
    // event handlers do units conversion

    // Create list components for resource assignment.
    // TEMP_PROBE_HR_names and DAC_HR_names are all we need.
    // May need range configuration value for DACs.

    // do loop function for probes and sim values, with units conversion.

}

function update_control(control, section_name) {
    let name = control.name;
    let value = control.value;
    if (name == "barometer") {
        name = "Ambient_pres";
    }
    if (control.units == "C") {
        value = CtoK(value);
    } else if (control.units == "mbar") {
        value = mbarToPa(value);
    } else if (control.units == "gph") {
        value = gphToCmps(value);
    } else if (control.units == "%") {
        value = Math.max(0, Math.min(1, value * 0.01));
    }
    var update_object = {};
    update_object[section_name] = {"name": name, "value": value};
    do_request("update", update_object);
}

function setup_temp_probe(temp_probe) {
    //XXX do more stuff here
    temp_probe_names.push(temp_probe.name);
}

function setup_dac(dac) {
    //XXX do more stuff here
    // need a max_scale configuration variable
    // need enable component
    //
    var dac_info = {
        name: dac.name,
        dac_output: dac,
        dac_enable: undefined,
        dac_full_scale: undefined,
        dac_updated: false,
    };

    dac_info.dac_enable = undefined;
    dac_info.dac_full_scale = undefined;
    dac_names.push(dac_info.name);
    dac.on("value_updated",
        function() { update_control(dac, "model_control"); });
}

module.exports.setup = function (cascade) {
    // Model selector:
    // Model selection triggers loading and initialization of the model
    model_selector = cascade.create_component({
        id: "stillsim_models",
        name: "Stillsim models",
        group: SIM_GROUP,
        display_order: utils.next_display_order(),
        class: "sim_info",
        type: cascade.types.OPTIONS,
        info: {options: []},
    });
    model_selector.on("value_updated", function() {load_model(cascade);});

    // current_run and current_state components are updated
    // by do_request() on each call.
    current_run = cascade.create_component({
        id: "current_run",
        name: "Current simulation run",
        group: SIM_GROUP,
        display_order: utils.next_display_order(),
        class: "sim_info",
        type: cascade.types.TEXT,
        read_only: true,
    });
    current_state = cascade.create_component({
        id: "current_state",
        name: "Current simulator state",
        group: SIM_GROUP,
        display_order: utils.next_display_order(),
        class: "sim_info",
        type: cascade.types.TEXT,
        read_only: true,
    });

    // Get model list and current state
    do_request("read_status", null)
        .then(function(result) {
            model_selector.info.options = result.meta.model_list;

            // If a model is already loaded, restrict model options to that model.
            if (current_state.value != "unloaded") {
                let model = current_run.slice(0, -9);
                model_selector.info.options = [model];
                model_selector.value = model;
            }
        })
        .catch(function(err) {
            cascade.log_error(new Error("Sim model error: " + err));
            return;
        });

    cascade.require_component("run_mode",
        function(component) {
            run_mode = component;
            run_mode.info.options.unshift("UNLOAD");

            // set run_mode to match current simulator state
            switch(current_state.value) {
                case "unloaded": {
                    run_mode.value = "UNLOAD";
                    break;
                }
                case "loaded": {
                    run_mode.value = "STOP";
                    break;
                }
                case "running": {
                    run_mode.value = "RUN";
                    break;
                }
            }

            run_mode.on("value_updated",
                function() {execute_run_mode(cascade);});
        });
};




/*
What do we do about run_duration running out and being extended?
The state can be "waiting" or maybe "stopped" and run_mode is still "RUN".
sim_state.on() {...}
XXX Do we need another run_mode?  WAIT?
Can we monkey patch it into the component?
*/

// set barometer to sim cntl Ambient_pres; convert to mbar
// Any probe with at units of 'K' is a temp probe; convert to C

// model/controller notes:
// Main control is stripper heater.
// pre-heater is implemented by setting feed_wash_T
// draws are fractional (true reflux), not set rate.
// XXX add set rate draws
// change reflux in reverse of how draw rate changes (more draw = less reflux)



module.exports.loop = function (cascade) {
    //Update sensor components.
};
