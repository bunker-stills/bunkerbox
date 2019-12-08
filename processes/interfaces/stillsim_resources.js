const _ = require("underscore");
const got = require("got");
const utils = require("./utils");

var SIM_URL = process.env.SIM_URL || "http://127.0.0.1:3300/";

var RUN_GROUP = "00  Run";
var SIMMETA_GROUP = "01  Simulation Metadata";   // meta, sim_value, sim_control
var MODSET_GROUP = "02  Model Settings";
var SENSORS_GROUP = "97  Model Sensors";
var PROCESS_CONTROLS_GROUP = "98  Model Controls";

var latest_status;    // json object returned by simulation server
var model_selector;   // local component
var run_name;         // local component
var simulator_state;  // local component
var run_mode;         // component from stills.js

var simmetas = {};
var settings = {};
var dacs = {};
var temp_probes = {};

var dac_names = [];
var temp_probe_names = [];


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
                    simulator_state.value = result.meta.state;
                    run_name.value = result.meta.current_run;
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
    if (model_selector.value && simulator_state.value == "unloaded") {
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
        let current_model = run_name.value.slice(9,-9);
        model_selector.info.options = [current_model];
        if (model_selector.value != current_model) {
            model_selector.value = current_model;
        }

        if (simulator_state.value == "running") {
            run_mode.value = "RUN";
        } else {
            run_mode.value = "STOP";
        }
    }
}

function execute_run_mode(cascade) {
    let state = simulator_state.value;
    switch (run_mode.value.toUpperCase()) {
        case "UNLOAD": {
            if (state == "unloaded") break;

            if (state === "running") {
                do_request("stop")
                    .catch(function(err) {
                        cascade.log_error(
                            new Error("Stopping on run_mode UNLOAD: " + err));
                    });
                run_mode.value = "STOP";
            }
            do_request("unload")
                .catch(function(err) {
                    cascade.log_error(new Error("On run_mode UNLOAD: " + err));
                });
            model_selector.info.options = latest_status.meta.model_list;
            model_selector.value = undefined;
            setTimeout(function(){process.exit();}, 3000);
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
        case "PAUSE": {
            if (state === "pause") break;
            if (state === "unloaded") {
                // return state to UNLOAD; use model selector to get to loaded
                run_mode.value = "UNLOAD";
            }

            do_request("stop")
                .catch(function(err) {
                    cascade.log_error(new Error("On run_mode PAUSE: " + err));
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
        let volatiles = molvec.slice(1);  // index 1 to end
        let v_sum = volatiles.reduce((a, b) => a + b, 0);
        abv /= 100;
        let newvec = [1 - abv].concat(volatiles.map((a) => a * abv/v_sum));
        return newvec;
    }
}
function pctToScale(pct, max_range) {return pct/100 * max_range;}
//function scaleToPct(scaleVal, max_range) {scaleVal/max_range * 100;}

function setup_simmeta(cascade, info_obj) {
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
    if (!info_obj.read_only) {
        info_obj.component.on("value_updated", function() {
            update_setting(cascade, info_obj, true);
        });
    }

    simmetas[info_obj.name] = info_obj;
}

function setup_setting(cascade, info_obj, log_change) {
    info_obj.prior_val = info_obj.value;
    delete info_obj.value;

    info_obj.component = cascade.create_component({
        id: info_obj.name,
        name: info_obj.name,
        group: info_obj.group,
        display_order: utils.next_display_order(),
        read_only: info_obj.read_only,
        type: info_obj.type,
        units: info_obj.units,
        value: info_obj.read_function(info_obj.prior_val),
    });

    settings[info_obj.name] = info_obj;

    info_obj.component.on("value_updated", function() {
        update_setting(cascade, info_obj, log_change);
    });
}

function setup_dac(cascade, info_obj) {
    info_obj.prior_val = info_obj.value;
    delete info_obj.value;

    info_obj.enable = cascade.create_component({
        id: info_obj.name + "_enable",
        name: info_obj.name + " Enable",
        group: info_obj.group,
        display_order: utils.next_display_order(),
        read_only: info_obj.read_only,
        type: "BOOLEAN",
        value: false,
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

    if (info_obj.units !== "%") {  // then we need max_range.
        info_obj.max_range = cascade.create_component({
            id: info_obj.name + "_max_range",
            name: info_obj.name + " Max Range",
            group: info_obj.group,
            persist: true,
            display_order: utils.next_display_order(),
            read_only: false,
            type: "NUMBER",
            units: info_obj.units,
            value: info_obj.read_function(info_obj.value),
        });
    }

    dacs[info_obj.name] = info_obj;
    dac_names.push(info_obj.name);

    info_obj.enable.on("value_updated", function() {
        update_dac(cascade, info_obj);
    });
    info_obj.output.on("value_updated", function() {
        update_dac(cascade, info_obj);
    });
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
    // simulator values to control and monitor simulation process
    var obj;
    obj = latest_status.sim_value;
    for (let name in obj) { if (obj.hasOwnProperty(name)) {
        //let sim_val = {};
        let sim_val = obj[name];
        if (sim_val.name == "Time") sim_val.name = "simulated_time";
        sim_val.section_name = "sim_value";
        sim_val.remote_name = name;
        sim_val.group = SIMMETA_GROUP;
        sim_val.read_function = identity;
        sim_val.write_function = identity;
        setup_simmeta(cascade, sim_val);
    }}
    obj = latest_status.sim_control;
    for (let name in obj) { if (obj.hasOwnProperty(name)) {
        let sim_ctl = obj[name];
        sim_ctl.section_name = "sim_control";
        sim_ctl.remote_name = sim_ctl.name;
        if (sim_ctl.name == "Ambient_temp") {
            sim_ctl.group = MODSET_GROUP;
            sim_ctl.units = "C";
            sim_ctl.read_function = KtoC;
            sim_ctl.write_function = CtoK;
            setup_setting(cascade, sim_ctl);
        }
        else if (sim_ctl.name == "Ambient_pres") {
            sim_ctl.name = "barometer";
            sim_ctl.group = MODSET_GROUP;
            sim_ctl.units = "mbar";
            sim_ctl.read_function = PaToMbar;
            sim_ctl.write_function = mbarToPa;
            setup_setting(cascade, sim_ctl);
        }
        else {
            sim_ctl.group = SIMMETA_GROUP;
            sim_ctl.read_function = identity;
            sim_ctl.write_function = identity;
            setup_simmeta(cascade, sim_ctl);
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
        "TEMP_PROBE_HR_names", temp_probe_names.sort());
    utils.update_hard_resource_list_component(cascade,
        "DAC_HR_names", dac_names.sort());
}

function write_out_val(cascade, val, info_obj) {
    let req_body = {};
    req_body[info_obj.section_name] = {};
    req_body[info_obj.section_name][info_obj.remote_name] = val;
    do_request("update", req_body)
        .catch(function(err) {
            cascade.log_error(new Error("Control value write error: " + err));
            cascade.log_error("Offending object:\n" + JSON.stringify(info_obj, null, 4));
        });
}

function update_setting(cascade, info_obj, log_change) {
    if (!_.isUndefined(log_change) && log_change) {
        cascade.log_info("update_setting: "
            + info_obj.section_name + "." + info_obj.remote_name
            + "  to value " + info_obj.component.value);
    }
    // convert controller units to simulator units
    var new_val = info_obj.write_function(info_obj.component.value, info_obj.prior_val);
    // send update to simulator
    if (new_val != info_obj.prior_val) {
        info_obj.prior_val = new_val;
        write_out_val(cascade, new_val, info_obj);
    }
}

function update_dac(cascade, info_obj) {
    var val;
    if (info_obj.enable.value === true) {
        val = info_obj.output.value;
        if (info_obj.max_range) {
            // convert from percent to scale value (in controller units)
            val = pctToScale(val, info_obj.max_range.value);
        }
    } else {
        val = 0;
    }
    // convert from controller units to simulator units
    val = info_obj.write_function(val);
    // send update to simulator
    if (val != info_obj.prior_val) {
        /*
        cascade.log_info("update_dac: "
            + info_obj.section_name + "." + info_obj.remote_name
            + "  to value " + info_obj.output.value
            + " from value " + info_obj.prior_val);
        */
        info_obj.prior_val = val;
        write_out_val(cascade, val, info_obj);
    }
}

function sync_state() {
    // set run_mode to match current simulator state
    switch(simulator_state.value) {
        case undefined:
        case "unloaded": {
            run_mode.value = "UNLOAD";
            break;
        }
        case "stopped":
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

    utils.setup_utils(cascade);
    utils.setup_overtemp(RUN_GROUP);

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

    // run_name and simulator_state components are updated
    // by do_request() on each call.
    run_name = cascade.create_component({
        id: "run_name",
        name: "Current simulation run",
        group: SIMMETA_GROUP,
        display_order: utils.next_display_order(),
        class: "sim_info",
        type: cascade.TYPES.TEXT,
        read_only: true,
    });
    simulator_state = cascade.create_component({
        id: "simulator_state",
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
            if (simulator_state.value != "unloaded") {
                let model = run_name.value.slice(9, -9);
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
            run_mode.info.options.push("PAUSE");
            // eslint-disable-next-line no-self-assign
            run_mode.info = run_mode.info;  // trigger update

            sync_state();  // set run_mode to correspond to simulator.

            run_mode.on("value_updated",
                function() {execute_run_mode(cascade);});
        });

    cascade.log_info("stillsim_resources.setup exited.");
};

function read_in_value(req_result, info_obj) {
    let response = req_result[info_obj.section_name][info_obj.remote_name];
    let val = "";
    if (response) {
        val = response.value;
    }
    // convert to controller units
    val = info_obj.read_function(val);
    // set local value
    info_obj.component.value = val;
}

module.exports.loop = function (cascade) {
    utils.log_cycle();

    // get latest values
    do_request("read_status", null)
        .then(function(result) {
            // Update sim values
            for (let id in simmetas) { if (simmetas.hasOwnProperty(id)) {
                let info_obj = simmetas[id];
                if (info_obj.read_only) {
                    read_in_value(result, simmetas[id]);
                }
            }}
            // Update sensor components.
            for (let id in temp_probes) { if (temp_probes.hasOwnProperty(id)) {
                read_in_value(result, temp_probes[id]);
                let temp = temp_probes[id].component.value;
                utils.check_max_temp(temp, id);
            }}
        })
        .catch(function(err) {
            cascade.log_error(new Error("Loop status request error: " + err));
        });
};
