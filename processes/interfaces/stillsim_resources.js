const got = require("got");
const utils = require("./utils");

var SIM_URL = process.env.SIM_URL || "http://127.0.0.1:3300/";

var RUN_GROUP = "00  Run";
var SIMMETA_GROUP = "01  Simulation Metadata";   // meta, sim_value, sim_control
var MODSET_GROUP = "02  Model Settings";
var SENSORS_GROUP = "97  Model Sensors";
var PROCESS_CONTROLS_GROUP = "98  Model Controls";
var RESOURCE_NAMES_GROUP = "99  Model Resources";

var latest_status;  // returned json object
var model_selector; // local component
var current_run;    // local component
var current_state;  // local component
var run_mode;       // component from stills.js

var simmetas = {};
var settings = {};
var dacs = {};
var temp_probes = {};

var dac_names = [];
var temp_probe_names = [];

var max_temp;  // max value of all probes (component)

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
    if (current_state.value == "unloaded") {
        // load model
        do_request("load", {"modelnm": model_selector.value})
            .then(function() {
                model_selector.info.options = [model_selector.value];
                run_mode.value = "STOP";

                // get list of controls and probes from current status
                get_probes_and_controls(cascade);
            })
            .catch(function(err) {
                cascade.log_error(new Error("Sim model load error: " + err));
            });
    } else {
        let current_model = current_run.value.slice(0,-9);
        model_selector.info.options = [current_model];
        if (model_selector.value != current_model) {
            model_selector.value = current_model;
        }

        if (current_state.value == "running") {
            run_mode.value = "RUN";
        } else {
            run_mode.value = "STOP";
        }
    }
}

function execute_run_mode(cascade) {
    let state = current_state.value;
    switch (run_mode.value.toUpperCase()) {
        case "UNLOAD": {
            if (state == "unloaded") break;

            if (state === "running") {
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
            model_selector.info.options = latest_status.meta.model_list;
            model_selector.value = undefined;
            break;
        }
        case "STOP": {
            if (state === "loaded") break;
            if (state === "unloaded") {
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
            if (state === "running") break;
            if (state === "unloaded") {
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

function identity(x) {return x;}
function KtoC(K) {if (K) return K-273.15;}
function CtoK(C) {if (C) return C+273.15;}
function mbarToPa(mbar) {if (mbar) return mbar*100;}
function PaToMbar(Pa) {if (Pa) return Pa*0.01;}
function gphToCmps(gph) {if (gph) return gph*1.0515e-6;}
function cmpsToGph(cmps) {if (cmps) return cmps*9.5102e5;}
function pctToFraction(pct) {if (pct) return pct/100;}
function fractionToPct(frac) {if (frac) return frac*100;}
function molvecToAbv(molvec) {
    if (molvec) return (1 - molvec[0]/molvec.reduce((a, b) => a + b, 0))*100;
}
function abvToMolvec(abv, molvec) {
    if (abv && molvec) {
        let volatiles = molvec.slice(1);
        let v_sum = volatiles.reduce((a, b) => a + b, 0);
        let newvec = [1 - abv].concat(volatiles.map((a) => a * abv/v_sum));
        return newvec;
    }
}
function pctToScale(pct, max_scale) {pct/100 * max_scale;}
//function scaleToPct(scaleVal, max_scale) {scaleVal/max_scale * 100;}

function setup_simmeta(cascade, info_obj) {
    info_obj.component = cascade.create_component({
        id: info_obj.name,
        name: info_obj.name,
        group: info_obj.group,
        display_order: utils.next_display_order(),
        read_only: true,
        type: info_obj.type,
        units: info_obj.units,
        value: info_obj.read_function(info_obj.value),
    });

    simmetas[info_obj.name] = info_obj;
}

function setup_setting(cascade, info_obj) {
    info_obj.component = cascade.create_component({
        id: info_obj.name,
        name: info_obj.name,
        group: info_obj.group,
        display_order: utils.next_display_order(),
        read_only: info_obj.read_only,
        type: info_obj.type,
        units: info_obj.units,
        value: info_obj.read_function(info_obj.value),
    });
    info_obj.component.on("value_updated", function() {
        update_setting(cascade, info_obj);
    });

    settings[info_obj.name] = info_obj;
}

function setup_dac(cascade, info_obj) {
    info_obj.enable = cascade.create_component({
        id: info_obj.name + "_enable",
        name: info_obj.name + " Enable",
        group: info_obj.group,
        display_order: utils.next_display_order(),
        read_only: info_obj.read_only,
        type: "BOOLEAN",
        value: false,
    });
    info_obj.enable.on("value_updated", function() {
        update_dac(cascade, info_obj);
    });

    info_obj.output = cascade.create_component({
        id: info_obj.name + "_output",
        name: info_obj.name + " Output",
        group: info_obj.group,
        display_order: utils.next_display_order(),
        read_only: info_obj.read_only,
        type: info_obj.type,
        units: "%",
        value: 0,
    });
    info_obj.output.on("value_updated", function() {
        update_dac(cascade, info_obj);
    });

    if (info_obj.units !== "%") {  // then we need max_range.
        info_obj.max_range = cascade.create_component({
            id: info_obj.name + "_max_range",
            name: info_obj.name + " Max Range",
            group: info_obj.group,
            display_order: utils.next_display_order(),
            read_only: false,
            type: "NUMBER",
            units: info_obj.units,
            value: info_obj.read_function(info_obj.value),
        });
    }

    dacs[info_obj.name] = info_obj;
    dac_names.push(info_obj.name);
}

function setup_temp_probe(cascade, info_obj) {
    info_obj.component = cascade.create_component({
        id: info_obj.name + "_calibrated",  // to conform with physical still naming
        name: info_obj.name + " Calibrated",
        group: info_obj.group,
        display_order: utils.next_display_order(),
        read_only: info_obj.read_only,
        type: info_obj.type,
        units: info_obj.units,
        value: info_obj.read_function(info_obj.value),
    });

    temp_probes[info_obj.name] = info_obj;
    temp_probe_names.push(info_obj.name);
}

function get_probes_and_controls(cascade) {
    cascade.log_info("get_probes... latest_status:\n" + JSON.stringify(latest_status));

    // simulator values to control and monitor simulation process
    var obj;
    obj = latest_status.sim_value;
    for (let name in obj) { if (obj.hasOwnProperty(name)) {
        let sim_val = obj[name];
        sim_val.remote_name = sim_val.name;
        sim_val.section_name = "sim_value";
        sim_val.group = SIMMETA_GROUP;
        sim_val.read_function = identity;
        sim_val.write_function = identity;
        setup_simmeta(cascade, sim_val);
    }}
    obj = latest_status.sim_control;
    for (let name in obj) { if (obj.hasOwnProperty(name)) {
        let sim_ctl = obj[name];
        sim_ctl.group = SIMMETA_GROUP;
        sim_ctl.remote_name = sim_ctl.name;
        sim_ctl.section_name = "sim_control";
        if (sim_ctl.units == "K") {
            sim_ctl.units = "C";
            sim_ctl.read_function = KtoC;
            sim_ctl.write_function = CtoK;
            if (sim_ctl.name == "Ambient_temp") {
                sim_ctl.group = MODSET_GROUP;
            }
            setup_setting(cascade, sim_ctl);
        }
        if (sim_ctl.name == "Ambient_pres") {
            sim_ctl.name = "barometer";
            sim_ctl.group = MODSET_GROUP;
            sim_ctl.units = "mbar";
            sim_ctl.read_function = PaToMbar;
            sim_ctl.write_function = mbarToPa;
            setup_setting(cascade, sim_ctl);
        }
    }}

    // sensors and controls on the still model
    obj = latest_status.model_probe;
    for (let name in obj) { if (obj.hasOwnProperty(name)) {
        let probe = obj[name];
        if (probe.name.startsWith("ambient")) continue;
        if (probe.units != "K") continue;

        probe.remote_name = probe.name;
        probe.section_name = "model_probe";
        probe.group = SENSORS_GROUP;
        probe.units = "C";
        probe.read_function = KtoC;
        probe.write_function = CtoK;
        setup_temp_probe(cascade, probe);
    }}

    obj = latest_status.model_control;
    for (let name in obj) { if (obj.hasOwnProperty(name)) {
        let control = obj[name];
        control.remote_name = control.name;
        control.section_name = "model_control";

        if (control.units.toUpperCase() == "MOL") {
            control.units = "%";
            control.group = MODSET_GROUP;
            control.type = "NUMBER";
            control.read_function = molvecToAbv;
            control.write_function = abvToMolvec;
            setup_setting(cascade, control);
        }
        if (control.units == "K") {
            control.group = MODSET_GROUP;
            control.units = "C";
            control.read_function = KtoC;
            control.write_function = CtoK;
            setup_setting(cascade, control);
        }

        if (control.units == "m^3/s") {
            control.group = PROCESS_CONTROLS_GROUP;
            control.units = "gph";
            control.read_function = cmpsToGph;
            control.write_function = gphToCmps;
            setup_dac(cascade, control);
        }
        if (control.units == "0-1") {
            control.group = PROCESS_CONTROLS_GROUP;
            control.units = "%";
            control.read_function = fractionToPct;
            control.write_function = pctToFraction;
            setup_dac(cascade, control);
        }
        if (control.units == "W") {
            control.group = PROCESS_CONTROLS_GROUP;
            control.read_function = identity;
            control.write_function = identity;
            setup_dac(cascade, control);
        }
    }}

    // names for soft_resource assignments.
    utils.update_hard_resource_list_component(cascade,
        "TEMP_PROBE_HR_names", temp_probe_names.sort(), RESOURCE_NAMES_GROUP);
    utils.update_hard_resource_list_component(cascade,
        "DAC_HR_names", dac_names.sort(), RESOURCE_NAMES_GROUP);
}

function write_out_val(cascade, val, info_obj) {
    let req_body = {};
    req_body[info_obj.section_name] = {};
    req_body[info_obj.section_name][info_obj.remote_name] = val;
    do_request("update", req_body)
        .catch(function(err) {
            cascade.log_error(new Error("Control value write error: " + err));
        });
}

function update_setting(cascade, info_obj) {
    // convert controller units to simulator units
    var val = info_obj.write_function(info_obj.component.value);
    // send update to simulator
    write_out_val(cascade, val, info_obj);
}

function update_dac(cascade, info_obj) {
    var val;
    if (info_obj.enable.value === true) {
        val = info_obj.output.value;
        if (info_obj.max_scale) {
            // convert from percent to scale value (in controller units)
            val = pctToScale(val, info_obj.max_scale.value);
        }
    } else {
        val = 0;
    }
    // convert from controller units to simulator units
    val = info_obj.write_function(val);
    // send update to simulator
    write_out_val(cascade, val, info_obj);
}

function sync_state() {
    // set run_mode to match current simulator state
    switch(current_state.value) {
        case undefined:
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
}

module.exports.setup = function (cascade) {
    cascade.log_info("stillsim_resources.setup entered.");

    // Create max_temp component used by stills overtemp shutdown feature.
    max_temp = cascade.create_component({
        id: "max_temp",
        name: "Max Temperature",
        description: "Peak measured temperature",
        group: RUN_GROUP,
        display_order: 1000,
        units: "C",
        value: 0,
    });

    // Model selector:
    // Model selection triggers loading and initialization of the model
    model_selector = cascade.create_component({
        id: "stillsim_models",
        name: "Stillsim models",
        group: SIMMETA_GROUP,
        display_order: utils.next_display_order(),
        class: "sim_info",
        type: cascade.TYPES.OPTIONS,
        info: {options: []},
    });
    model_selector.on("value_updated", function() {load_model(cascade);});

    // current_run and current_state components are updated
    // by do_request() on each call.
    current_run = cascade.create_component({
        id: "current_run",
        name: "Current simulation run",
        group: SIMMETA_GROUP,
        display_order: utils.next_display_order(),
        class: "sim_info",
        type: cascade.TYPES.TEXT,
        read_only: true,
    });
    current_state = cascade.create_component({
        id: "current_state",
        name: "Current simulator state",
        group: SIMMETA_GROUP,
        display_order: utils.next_display_order(),
        class: "sim_info",
        type: cascade.TYPES.TEXT,
        read_only: true,
    });

    // Get model list and current state
    do_request("read_status", null)
        .then(function(result) {
            cascade.log_info("stillsim_resources.setup model options: " +
                result.meta.model_list);

            sync_state();  // set run_mode to correspond to simulator.

            model_selector.info.options = result.meta.model_list;

            // If a model is already loaded, restrict model options to that model.
            if (current_state.value != "unloaded") {
                let model = current_run.value.slice(0, -9);
                model_selector.info.options = [model];
                model_selector.value = model;
            }
            // eslint-disable-next-line no-self-assign
            model_selector.info = model_selector.info;  // trigger update
        })
        .catch(function(err) {
            cascade.log_error(new Error("Sim model error: " + err));
            return;
        });

    cascade.components.require_component("run_mode",
        function(component) {
            cascade.log_info("stillsim_resources.setup run_mode component found.");

            run_mode = component;
            run_mode.info.options.unshift("UNLOAD");
            // eslint-disable-next-line no-self-assign
            run_mode.info = run_mode.info;  // trigger update

            sync_state();  // set run_mode to correspond to simulator.

            run_mode.on("value_updated",
                function() {execute_run_mode(cascade);});
        });

    cascade.log_info("stillsim_resources.setup exited.");
};

function read_in_value(req_result, info_obj) {
    let val = req_result[info_obj.section_name][info_obj.remote_name];
    // convert to controller units
    val = info_obj.read_function(val);
    // set local value
    info_obj.component.value = val;
}

module.exports.loop = function (cascade) {
    // get latest values
    do_request("read_status", null)
        .then(function(result) {
        // Update sim values
            for (let id in simmetas) { if (simmetas.hasOwnProperty(id)) {
                read_in_value(result, simmetas[id]);
            }}
            // Update sensor components.
            for (let id in temp_probes) { if (temp_probes.hasOwnProperty(id)) {
                read_in_value(result, temp_probes[id]);
                let temp = temp_probes[id].component.value;
                if (temp > max_temp.value) {
                    max_temp.value = temp;
                }
            }}
        })
        .catch(function(err) {
            cascade.log_error(new Error("Loop status request error: " + err));
        });
};
