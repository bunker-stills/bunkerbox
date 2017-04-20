var _ = require("underscore");
var pid_controller = require("./../lib/pid");
var duty_cycle = require("./../lib/duty_cycle");
var sigmoid = require("./../lib/sigmoid");

var PUMP_PRIME_PERCENT = Number(process.env.PUMP_PRIME_PERCENT) || 25;

var SENSOR_OFFLINE_SECONDS = Number(process.env.SENSOR_OFFLINE_SECONDS) || 20;
var TEMP_SENSOR_OVERHEAT_LIMIT = Number(process.env.TEMP_SENSOR_OVERHEAT_LIMIT) || 230; // Degrees F
var COOLDOWN_TEMP_TARGET = Number(process.env.COOLDOWN_TEMP_TARGET) || 170; // Degrees F
var PUMP_COOLDOWN_PERCENT = Number(process.env.PUMP_COOLDOWN_PERCENT) || 10;
var PUMP_MIN_PID_PERCENT = Number(process.env.PUMP_MIN_PID_PERCENT) || 5;
var PUMP_MAX_PID_PERCENT = Number(process.env.PUMP_MAX_PID_PERCENT) || 20;
var MAIN_HEATER_RUN_PERCENT = Number(process.env.MAIN_HEATER_RUN_PERCENT) || 90;

var FEED_CYCLE_TIME_IN_SECONDS = Number(process.env.FEED_CYCLE_TIME_IN_SECONDS) || 10;

// WARMUP PARAMETERS
var PRE_HEATER_WARMUP_P_GAIN = Number(process.env.PRE_HEATER_WARMUP_P_GAIN) || 0.2;
var PRE_HEATER_WARMUP_I_GAIN = Number(process.env.PRE_HEATER_WARMUP_I_GAIN) || 0.01;
var PRE_HEATER_WARMUP_D_GAIN = Number(process.env.PRE_HEATER_WARMUP_D_GAIN) || 0.0;
var PRE_HEATER_WARMUP_SET_POINT = Number(process.env.PRE_HEATER_WARMUP_SET_POINT) || 85; // Degrees F
var PUMP_WARMUP_PERCENT = Number(process.env.PUMP_WARMUP_PERCENT) || 11;
var MAIN_HEATER_WARMUP_SECONDS = Number(process.env.MAIN_HEATER_WARMUP_SECONDS) || 900;
var DESIRED_FEED_ABV_WARMUP = Number(process.env.DESIRED_FEED_ABV_WARMUP) || 1; // Percent

// STARTUP PARAMETERS
var PRE_HEATER_STARTUP_P_GAIN = Number(process.env.PRE_HEATER_STARTUP_P_GAIN) || 0.2;
var PRE_HEATER_STARTUP_I_GAIN = Number(process.env.PRE_HEATER_STARTUP_I_GAIN) || 0.01;
var PRE_HEATER_STARTUP_D_GAIN = Number(process.env.PRE_HEATER_STARTUP_D_GAIN) || 0.0;
var PRE_HEATER_STARTUP_SET_POINT = Number(process.env.PRE_HEATER_STARTUP_SET_POINT) || 85; // Degrees F
var DESIRED_FEED_ABV_STARTUP = Number(process.env.DESIRED_FEED_ABV_STARTUP) || 8; // Percent
var PUMP_STARTUP_P_GAIN = Number(process.env.PUMP_STARTUP_P_GAIN) || -0.09;
var PUMP_STARTUP_I_GAIN = Number(process.env.PUMP_STARTUP_I_GAIN) || -0.002;
var PUMP_STARTUP_D_GAIN = Number(process.env.PUMP_STARTUP_D_GAIN) || 0.0;
var SUMP_TEMP_BP_OFFSET_STARTUP = Number(process.env.SUMP_TEMP_BP_OFFSET_STARTUP) || 1.0;

var runMode;
var feedABV;
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
}

function runDutyCycle(controlComponentID, dutyPercentage)
{
    dutyCycles[controlComponentID].start(dutyPercentage);
}

function stopDutyCycle(controlComponentID)
{
    dutyCycles[controlComponentID].stop();
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
    return Math.log(baroInHG) * 49.160999 + 44.93;
}

function setDesiredFeedABV(desiredABV)
{
    var inputABV = feedABV.value || 0.0;

    // If the input ABV is less than the desired ABV, there is nothing we can do— use full feed strength.
    if(inputABV <= desiredABV)
    {
        controllerComponents.feed_relay.value = true;
        return;
    }

    runDutyCycle("feed_relay", desiredABV / inputABV);
}

module.exports.setup = function (cascade) {

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
        "sump_temp"
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
        group: "run",
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

    feedABV = cascade.create_component({
        id: "feed_abv",
        name: "Feed ABV",
        group: "run",
        units: cascade.UNITS.PERCENTAGE,
        type: cascade.TYPES.NUMBER
    });

    createPID("preHeater", "pre_heater_temp", "pre_heater_output", "pre_heater_enable", 0, 100);
    createPID("pump", "sump_temp", "pump_output", "pump_enable", PUMP_MIN_PID_PERCENT, PUMP_MAX_PID_PERCENT);
    createDutyCycle("feed_relay", FEED_CYCLE_TIME_IN_SECONDS);
};

function duringIdle(cascade) {

    resetPID("preHeater");
    resetPID("pump");

    controllerComponents.pump_enable.value = false;
    controllerComponents.pump_output.value = 0;

    controllerComponents.main_heater_enable.value = false;
    controllerComponents.main_heater_output.value = 0;

    controllerComponents.pre_heater_enable.value = false;
    controllerComponents.pre_heater_output.value = 0;

    stopDutyCycle("feed_relay");
    controllerComponents.feed_relay.value = false;

    controllerComponents.hearts_reflux_relay.value = false;
    controllerComponents.tails_reflux_relay.value = false;
}

function duringPumpPrime(cascade)
{
    feedFromWater();

    controllerComponents.pump_enable.value = true;
    controllerComponents.pump_output.value = PUMP_PRIME_PERCENT;
}

function duringWarmup(cascade) {

    setDesiredFeedABV(DESIRED_FEED_ABV_WARMUP);

    // Run our pump at a constant rate
    controllerComponents.pump_enable.value = true;
    controllerComponents.pump_output.value = PUMP_WARMUP_PERCENT;
    // Prime our pump integral so that it runs pretty closely to current amount when it switches over to the PID
    pids["pump"].controller.setIntegral(PUMP_WARMUP_PERCENT);

    // Reflux everything
    controllerComponents.hearts_reflux_relay.value = true;
    controllerComponents.tails_reflux_relay.value = true;

    // Run our pre-heater in a PID
    runPID("preHeater", PRE_HEATER_WARMUP_P_GAIN, PRE_HEATER_WARMUP_I_GAIN, PRE_HEATER_WARMUP_D_GAIN, PRE_HEATER_WARMUP_SET_POINT, cascade);

    // Slowly warm up our main heater
    var warmupTimeInSeconds = ((new Date()) - modeChangeTime) / 1000;

    controllerComponents.main_heater_enable.value = true;
    if(warmupTimeInSeconds <= MAIN_HEATER_WARMUP_SECONDS) {
        // Use a sigmoid function to bring the heater up
        controllerComponents.main_heater_output.value = sigmoid.riseTo(warmupTimeInSeconds, 0, MAIN_HEATER_RUN_PERCENT, MAIN_HEATER_WARMUP_SECONDS);
    }
    else
    {
        controllerComponents.main_heater_output.value = MAIN_HEATER_RUN_PERCENT;

        // When we get here, we can move on to startup
        cascade.log_info("WARMUP stage completed. Moving to STARTUP.");
        runMode.value = "STARTUP";
    }
}

function duringStartup(cascade) {

    setDesiredFeedABV(DESIRED_FEED_ABV_STARTUP);

    // Calculate where we should try to maintain our sump temp, by adjusting our pump.
    var sumpSetPoint = getCurrentH20BoilingPoint() - SUMP_TEMP_BP_OFFSET_STARTUP;

    // Run our pump with a PID
    runPID("pump", PUMP_STARTUP_P_GAIN, PUMP_STARTUP_I_GAIN, PUMP_STARTUP_D_GAIN, sumpSetPoint, cascade);

    // Reflux everything
    controllerComponents.hearts_reflux_relay.value = true;
    controllerComponents.tails_reflux_relay.value = true;

    // Run our pre-heater in a PID
    runPID("preHeater", PRE_HEATER_STARTUP_P_GAIN, PRE_HEATER_STARTUP_I_GAIN, PRE_HEATER_STARTUP_D_GAIN, PRE_HEATER_STARTUP_SET_POINT, cascade);

    // Keep our main heater at constant power
    controllerComponents.main_heater_output.value = MAIN_HEATER_RUN_PERCENT;
}

function duringRun(cascade) {

}

function feedFromWater()
{
    stopDutyCycle("feed_relay");
    controllerComponents.feed_relay.value = false;
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

    controllerComponents.pump_enable.value = true;
    controllerComponents.pump_output.value = PUMP_COOLDOWN_PERCENT;

    controllerComponents.main_heater_enable.value = false;
    controllerComponents.main_heater_output.value = 0;

    controllerComponents.pre_heater_enable.value = false;
    controllerComponents.pre_heater_output.value = 0;
}

function checkforFailure(cascade)
{
    var failureDetected = false;

    if(!controllerComponents)
    {
        failureDetected = true;
        cascade.log_error("Controllers are offline.");
    }

    if(!sensorComponents)
    {
        failureDetected = true;
        cascade.log_error("Sensors are offline.");
    }

    var now = new Date();
    _.each(sensorComponents, function(sensorComponent){
        var timeDeltaInSeconds = (now - sensorComponent.updated) / 1000;

        if(timeDeltaInSeconds >= SENSOR_OFFLINE_SECONDS)
        {
            failureDetected = true;
            cascade.log_error("Sensor named '" + sensorComponent.name + "' went offline.");
        }

        if(sensorComponent.class === "process_temperature" && sensorComponent.value >= TEMP_SENSOR_OVERHEAT_LIMIT)
        {
            failureDetected = true;
            cascade.log_error("Sensor named '" + sensorComponent.name + "' detected overheating.");
        }
    });

    // If a failure has been detected, automatically go into cooldown mode
    if(failureDetected)
    {
        cascade.log_error("A problem was detected. Moving to COOLDOWN mode.");
        runMode.value = "COOLDOWN";
    }
}

module.exports.loop = function (cascade) {

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