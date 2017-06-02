var _ = require("underscore");
var pid_controller = require("./../lib/pid");
var duty_cycle = require("./../lib/duty_cycle");

var PUMP_PRIME_PERCENT = Number(process.env.PUMP_PRIME_PERCENT) || 25;

var SENSOR_OFFLINE_SECONDS = Number(process.env.SENSOR_OFFLINE_SECONDS) || 20;
var TEMP_SENSOR_OVERHEAT_LIMIT = Number(process.env.TEMP_SENSOR_OVERHEAT_LIMIT) || 230; // Degrees F

var FEED_CYCLE_TIME_IN_SECONDS = Number(process.env.FEED_CYCLE_TIME_IN_SECONDS) || 10;
var REFLUX_CYCLE_TIME_IN_SECONDS = Number(process.env.REFLUX_CYCLE_TIME_IN_SECONDS) || 20;

// WARMUP PARAMETERS
var PRE_HEATER_WARMUP_P_GAIN = Number(process.env.PRE_HEATER_WARMUP_P_GAIN) || 0.2;
var PRE_HEATER_WARMUP_I_GAIN = Number(process.env.PRE_HEATER_WARMUP_I_GAIN) || 0.001;
var PRE_HEATER_WARMUP_D_GAIN = Number(process.env.PRE_HEATER_WARMUP_D_GAIN) || 0.0;
var PRE_HEATER_WARMUP_SET_POINT = Number(process.env.PRE_HEATER_WARMUP_SET_POINT) || 80; // Degrees F
var MAIN_HEATER_WARMUP_P_GAIN = Number(process.env.MAIN_HEATER_WARMUP_P_GAIN) || 0.35;
var MAIN_HEATER_WARMUP_I_GAIN = Number(process.env.MAIN_HEATER_WARMUP_I_GAIN) || 0.001;
var MAIN_HEATER_WARMUP_D_GAIN = Number(process.env.MAIN_HEATER_WARMUP_D_GAIN) || 0.0;
var MAIN_HEATER_WARMUP_SET_POINT = Number(process.env.MAIN_HEATER_WARMUP_SET_POINT) || 200; // Degrees F
var PUMP_WARMUP_PERCENT = Number(process.env.PUMP_WARMUP_PERCENT) || 12;
var DESIRED_FEED_ABV_WARMUP = Number(process.env.DESIRED_FEED_ABV_WARMUP) || 1; // Percent

// STARTUP PARAMETERS
var PRE_HEATER_STARTUP_P_GAIN = Number(process.env.PRE_HEATER_STARTUP_P_GAIN) || 0.2;
var PRE_HEATER_STARTUP_I_GAIN = Number(process.env.PRE_HEATER_STARTUP_I_GAIN) || 0.001;
var PRE_HEATER_STARTUP_D_GAIN = Number(process.env.PRE_HEATER_STARTUP_D_GAIN) || 0.0;
var PRE_HEATER_STARTUP_SET_POINT = Number(process.env.PRE_HEATER_STARTUP_SET_POINT) || 80; // Degrees F
var DESIRED_FEED_ABV_STARTUP = Number(process.env.DESIRED_FEED_ABV_STARTUP) || 6; // Percent
var MAIN_HEATER_STARTUP_P_GAIN = Number(process.env.PUMP_STARTUP_P_GAIN) || 2.5;
var MAIN_HEATER_STARTUP_I_GAIN = Number(process.env.PUMP_STARTUP_I_GAIN) || 0.003;
var MAIN_HEATER_STARTUP_D_GAIN = Number(process.env.PUMP_STARTUP_D_GAIN) || 0.0;
var SUMP_TEMP_BP_OFFSET_STARTUP = Number(process.env.SUMP_TEMP_BP_OFFSET_STARTUP) || 0.5;
var PUMP_STARTUP_PERCENT = Number(process.env.PUMP_STARTUP_PERCENT) || 12;

// RUN PARAMETERS
var PRE_HEATER_RUN_P_GAIN = Number(process.env.PRE_HEATER_RUN_P_GAIN) || 0.2;
var PRE_HEATER_RUN_I_GAIN = Number(process.env.PRE_HEATER_RUN_I_GAIN) || 0.001;
var PRE_HEATER_RUN_D_GAIN = Number(process.env.PRE_HEATER_RUN_D_GAIN) || 0.0;
var PRE_HEATER_RUN_SET_POINT = Number(process.env.PRE_HEATER_RUN_SET_POINT) || 80; // Degrees F
var DESIRED_FEED_ABV_RUN = Number(process.env.DESIRED_FEED_ABV_RUN) || 6; // Percent
var MAIN_HEATER_RUN_P_GAIN = Number(process.env.PUMP_RUN_P_GAIN) || 2.5;
var MAIN_HEATER_RUN_I_GAIN = Number(process.env.PUMP_RUN_I_GAIN) || 0.003;
var MAIN_HEATER_RUN_D_GAIN = Number(process.env.PUMP_RUN_D_GAIN) || 0.0;
var SUMP_TEMP_BP_OFFSET_RUN = Number(process.env.SUMP_TEMP_BP_OFFSET_RUN) || 0.5;
var PUMP_RUN_PERCENT = Number(process.env.PUMP_RUN_PERCENT) || 12;

// COOLDOWN PARAMETERS
var COOLDOWN_TEMP_TARGET = Number(process.env.COOLDOWN_TEMP_TARGET) || 125; // Degrees F
var PUMP_COOLDOWN_PERCENT = Number(process.env.PUMP_COOLDOWN_PERCENT) || 20;

var runMode;
var feedABV;
var tailsFlux;
var heartsFlux;
var boilingPoint;
var sensorComponents;
var controllerComponents;
var dutyCycles = {};
var pids = {};
var modeChangeTime;

function createDutyCycle(controlComponentID, cycleTimeInSeconds)
{
    dutyCycles[controlComponentID] = new duty_cycle(cycleTimeInSeconds * 1000, function(){
        controllerComponents[controlComponentID].value = true;
    }, function(){
        controllerComponents[controlComponentID].value = false;
    });

    dutyCycles[controlComponentID].start(0);
}

function setDutyCycle(controlComponentID, dutyPercentage)
{
    dutyCycles[controlComponentID].set(dutyPercentage);
}

function createPID(name, processComponentID, cvComponentID, cvEnableComponentID, minCV, maxCV)
{
    var pid = {
        name : name,
        controller : new pid_controller(),
        processComponentID : processComponentID,
        cvComponentID : cvComponentID,
        cvEnableComponentID: cvEnableComponentID,
        minCV: minCV,
        maxCV : maxCV
    };

    pids[name] = pid;
}

function resetPID(name)
{
    var pid = pids[name];

    if(!pid)
    {
        console.log_error("Unable to find PID named '" + name + "'");
        return;
    }

    pid.controller.setProportionalGain(0);
    pid.controller.setIntegralGain(0);
    pid.controller.setDerivativeGain(0);
    pid.controller.reset();
}

function runPID(name, pGain, iGain, dGain, setPoint, cascade)
{
    var pid = pids[name];

    if(!pid)
    {
        cascade.log_error("Unable to find PID named '" + name + "'");
        return;
    }

    pid.controller.setControlValueLimits(pid.minCV, pid.maxCV);
    pid.controller.setProportionalGain(pGain);
    pid.controller.setIntegralGain(iGain);
    pid.controller.setDerivativeGain(dGain);
    pid.controller.setDesiredValue(setPoint);

    var control = controllerComponents[pid.cvComponentID];
    if(!control)
    {
        cascade.log_error("Unable to find controller for PID named '" + name + "'");
        return;
    }

    var processSensor = sensorComponents[pid.processComponentID];
    if(!processSensor)
    {
        cascade.log_error("Unable to find process sensor for PID named '" + name + "'");
        return;
    }

    control.value = pid.controller.update(processSensor.value);

    if(pid.cvEnableComponentID)
    {
        var controlEnable = controllerComponents[pid.cvEnableComponentID];
        if(!controlEnable)
        {
            cascade.log_error("Unable to find controller for PID named '" + name + "'");
            return;
        }

        controlEnable.value = true;
    }
}

function getCurrentH20BoilingPoint()
{
    var baroInHG = sensorComponents.barometer.value * 0.02953;

    if(!baroInHG)
    {
        return 212.0;
    }

    return Math.log(baroInHG) * 49.160999 + 44.93;
}

function setDesiredFeedABV(desiredABV)
{
    var inputABV = feedABV.value || 0.0;

    // If the input ABV is less than the desired ABV, there is nothing we can do— use full feed strength.
    if(inputABV <= desiredABV)
    {
        setDutyCycle("feed_relay", 1.0);
        return;
    }

    setDutyCycle("feed_relay", desiredABV / inputABV);
}

module.exports.setup = function (cascade) {

    process.on('SIGINT', function(){ console.log("Shutting Down"); duringIdle();});
    process.on('exit', function(){ console.log("Shutting Down"); duringIdle();});

    if(process.env.SIMULATE)
    {
        cascade.require_process("./../simulator/simulator");
    }
    else
    {
        cascade.require_process("./../interfaces/ds9490r");
        cascade.require_process("./../interfaces/tinkerforge");
    }

    cascade.require_process("./../update_manager");
    cascade.require_process("./../process_temps");

    cascade.components.require_component([
        "barometer",
        "heads_temp",
        "hearts_temp",
        "tails_temp",
        "pre_heater_temp",
        "sump_temp",
        "process_temps_online"
    ], function (comps) {
        sensorComponents = comps;
    });

    cascade.components.require_component([
        "main_heater_enable",
        "main_heater_output",
        "pre_heater_enable",
        "pre_heater_output",
        "pump_enable",
        "pump_output",
        "feed_relay",
        "hearts_reflux_relay",
        "tails_reflux_relay"
    ], function (comps) {
        controllerComponents = comps;
    });

    runMode = cascade.create_component({
        id: "run_mode",
        name: "Run Mode",
        group: "Run",
        type: cascade.TYPES.OPTIONS,
        info: {
            options: ["IDLE", "PUMP PRIME", "WARMUP", "STARTUP", "RUN", "COOLDOWN", "MANUAL"]
        },
        value: "IDLE"
    });
    runMode.on("value_updated", function(){
        modeChangeTime = new Date();
        cascade.log_info("Mode has been changed to " + runMode.value);
    });

    heartsFlux = cascade.create_component({
        id: "hearts_flux_percentage",
        name: "Hearts Flux Percentage",
        group: "Run",
        units: cascade.UNITS.PERCENTAGE,
        type: cascade.TYPES.NUMBER
    });

    tailsFlux = cascade.create_component({
        id: "tails_flux_percentage",
        name: "Tails Flux Percentage",
        group: "Run",
        units: cascade.UNITS.PERCENTAGE,
        type: cascade.TYPES.NUMBER
    });

    feedABV = cascade.create_component({
        id: "feed_abv",
        name: "Feed ABV",
        group: "Run",
        units: cascade.UNITS.PERCENTAGE,
        type: cascade.TYPES.NUMBER
    });

    boilingPoint = cascade.create_component({
        id: "boiling_point",
        name: "Boiling Point",
        group: "Run",
        read_only: true,
        units: cascade.UNITS.F,
        type: cascade.TYPES.NUMBER
    });

    createPID("preHeater", "pre_heater_temp", "pre_heater_output", "pre_heater_enable", 0, 100);
    createPID("mainHeater", "sump_temp", "main_heater_output", "main_heater_enable", 0, 100);
    createDutyCycle("feed_relay", FEED_CYCLE_TIME_IN_SECONDS);
    createDutyCycle("hearts_reflux_relay", REFLUX_CYCLE_TIME_IN_SECONDS);
    createDutyCycle("tails_reflux_relay", REFLUX_CYCLE_TIME_IN_SECONDS);
};

function duringIdle(cascade) {

    controllerComponents.pump_enable.value = false;
    controllerComponents.pump_output.value = 0;

    controllerComponents.main_heater_enable.value = false;
    controllerComponents.main_heater_output.value = 0;

    controllerComponents.pre_heater_enable.value = false;
    controllerComponents.pre_heater_output.value = 0;

    setDutyCycle("feed_relay", 0);
    setDutyCycle("hearts_reflux_relay", 0);
    setDutyCycle("tails_reflux_relay", 0);

    resetPID("preHeater");
    resetPID("mainHeater");
}

function duringPumpPrime(cascade)
{
    setDutyCycle("feed_relay", 0.5);

    controllerComponents.pump_enable.value = true;
    controllerComponents.pump_output.value = PUMP_PRIME_PERCENT;
}

function duringWarmup(cascade) {

    setDesiredFeedABV(DESIRED_FEED_ABV_WARMUP);

    // Flux everything
    setDutyCycle("hearts_reflux_relay", 0.0);
    setDutyCycle("tails_reflux_relay", 0.0);

    // Run our pump
    controllerComponents.pump_enable.value = true;
    controllerComponents.pump_output.value = PUMP_WARMUP_PERCENT;

    // Run our pre-heater in a PID
    runPID("preHeater", PRE_HEATER_WARMUP_P_GAIN, PRE_HEATER_WARMUP_I_GAIN, PRE_HEATER_WARMUP_D_GAIN, PRE_HEATER_WARMUP_SET_POINT, cascade);

    // Run our main-heater in a PID
    runPID("mainHeater", MAIN_HEATER_WARMUP_P_GAIN, MAIN_HEATER_WARMUP_I_GAIN, MAIN_HEATER_WARMUP_D_GAIN, MAIN_HEATER_WARMUP_SET_POINT, cascade);
}

function duringStartup(cascade) {
    setDesiredFeedABV(DESIRED_FEED_ABV_STARTUP);

    // Reflux everything
    setDutyCycle("hearts_reflux_relay", 1.0);
    setDutyCycle("tails_reflux_relay", 1.0);

    // Run our pump
    controllerComponents.pump_enable.value = true;
    controllerComponents.pump_output.value = PUMP_STARTUP_PERCENT;

    // // Run our heaters in PIDs
    runPID("preHeater", PRE_HEATER_STARTUP_P_GAIN, PRE_HEATER_STARTUP_I_GAIN, PRE_HEATER_STARTUP_D_GAIN, PRE_HEATER_STARTUP_SET_POINT, cascade);
    var sumpSetPoint = getCurrentH20BoilingPoint() - SUMP_TEMP_BP_OFFSET_STARTUP;
    runPID("mainHeater", MAIN_HEATER_STARTUP_P_GAIN, MAIN_HEATER_STARTUP_I_GAIN, MAIN_HEATER_STARTUP_D_GAIN, sumpSetPoint, cascade);
}

function duringRun(cascade) {
    setDesiredFeedABV(DESIRED_FEED_ABV_RUN);

    setDutyCycle("hearts_reflux_relay", heartsFlux.value / 100);
    setDutyCycle("tails_reflux_relay", tailsFlux.value / 100);

    // Run our pump
    controllerComponents.pump_enable.value = true;
    controllerComponents.pump_output.value = PUMP_RUN_PERCENT;

    // Run our heaters in PIDs
    runPID("preHeater", PRE_HEATER_RUN_P_GAIN, PRE_HEATER_RUN_I_GAIN, PRE_HEATER_RUN_D_GAIN, PRE_HEATER_RUN_SET_POINT, cascade);
    var sumpSetPoint = getCurrentH20BoilingPoint() - SUMP_TEMP_BP_OFFSET_RUN;
    runPID("mainHeater", MAIN_HEATER_RUN_P_GAIN, MAIN_HEATER_RUN_I_GAIN, MAIN_HEATER_RUN_D_GAIN, sumpSetPoint, cascade);
}

function duringCooldown(cascade) {

    // If the sump temp isn't available don't bother
    if(!sensorComponents.sump_temp)
    {
        runMode.value = "IDLE";
        return;
    }

    if(sensorComponents.sump_temp.value <= COOLDOWN_TEMP_TARGET)
    {
        runMode.value = "IDLE";
        cascade.log_info("Column has cooled sufficiently. Moving to IDLE mode.");
        return;
    }

    feedFromWater();

    // Flux everything
    setDutyCycle("hearts_reflux_relay", 0.0);
    setDutyCycle("tails_reflux_relay", 0.0);

    controllerComponents.pump_enable.value = true;
    controllerComponents.pump_output.value = PUMP_COOLDOWN_PERCENT;

    controllerComponents.main_heater_enable.value = false;
    controllerComponents.main_heater_output.value = 0;

    controllerComponents.pre_heater_enable.value = false;
    controllerComponents.pre_heater_output.value = 0;
}

function feedFromWater()
{
    setDutyCycle("feed_relay", 1.0);
}

function feedFromWash()
{
    setDutyCycle("feed_relay", 0.0);
}

function checkforFailure(cascade)
{

    if(!controllerComponents)
    {
        cascade.log_error("Controllers are offline.");
        runMode.value = "COOLDOWN";
        return;
    }

    if(!sensorComponents || !sensorComponents.process_temps_online)
    {
        cascade.log_error("Sensors are offline.");
        runMode.value = "COOLDOWN";
        return;
    }
}

module.exports.loop = function (cascade) {

    boilingPoint.value = getCurrentH20BoilingPoint();

    switch (runMode.value.toUpperCase()) {
        case "PUMP PRIME":
        {
            duringPumpPrime(cascade);
            break;
        }
        case "WARMUP" :
        {
            checkforFailure(cascade);
            duringWarmup(cascade);
            break;
        }
        case "STARTUP" :
        {
            checkforFailure(cascade);
            duringStartup(cascade);
            break;
        }
        case "RUN" :
        {
            checkforFailure(cascade);
            duringRun(cascade);
            break;
        }
        case "COOLDOWN" :
        {
            duringCooldown(cascade);
            break;
        }
        case "MANUAL" :
        {
            // Anything goes
            break;
        }
        default: {
            duringIdle(cascade);
            break;
        }
    }
};