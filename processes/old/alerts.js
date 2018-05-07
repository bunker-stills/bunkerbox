var _ = require("underscore");
var request = require("request");

var emailAddresses;
var enableAlerts;

var rules = [];
var components = {};

function addOverheatRule(cascade, tempComponentName, defaultMaxTemp, ruleID, ruleDescription)
{
    var maxTemp;

    addRule(cascade, function () {
        if (components[tempComponentName] && components[tempComponentName].value >= maxTemp.value)
        {
            return ruleDescription + ": " + components[tempComponentName].value + "F";
        }
    }, ruleID, ruleDescription);

    maxTemp = cascade.create_component({
        id: ruleID + "_max_temp",
        name: ruleDescription + " Max Temp.",
        units: cascade.UNITS.F,
        type: cascade.TYPES.NUMBER,
        group: "Alerts",
        persist: true,
        value: defaultMaxTemp
    });
}

function addRule(cascade, ruleFunction, ruleID, ruleDescription) {
    var rule = {
        ruleFunction: ruleFunction,
        active: false,
        lastSent: null
    };
    rules.push(rule);
}

function notifyOnRule(cascade, message) {

    if (!emailAddresses.value) {
        return;
    }

    var subject = 'Alert (' + process.env.DEVICE_ID + ')';
    var recipients = [];
    var addresses = emailAddresses.value.split(",");

    for(var index in addresses)
    {
        var email = addresses[index];
        recipients.push({"Email" : email});
    }

    request({
        url: 'https://d80454b2afd594ef692dc46b67687e60:5a8828700acd06e541c7f8a0eee6d282@api.mailjet.com/v3/send',
        method: 'POST',
        timeout: 10000,
        json: {
            "FromEmail":"no-reply@bunkerstills.com",
            "Subject":subject,
            "Text-part":message,
            "Recipients":recipients
        }
    }, function (e, r, body) {

    });

    cascade.log_error(subject + ": " + message);
}

function processRules(cascade) {
    _.each(rules, function (rule) {

        var outcome = rule.ruleFunction();

        if (outcome) {
            if (!rule.active) {
                rule.active = true;
                notifyOnRule(cascade, outcome);
            }
        }
        else {
            rule.active = false;
        }
    });
}

module.exports.setup = function (cascade) {

    enableAlerts = cascade.create_component({
        id: "alert_enable",
        name: "Enable Alerts",
        type: cascade.TYPES.BOOLEAN,
        group: "Alerts",
        persist: true,
        value: true
    });

    emailAddresses = cascade.create_component({
        id: "alert_email_addresses",
        name: "Email Addresses",
        type: cascade.TYPES.TEXT,
        group: "Alerts",
        persist: true
    });

    cascade.create_component({
        id: "alert_test",
        name: "Test",
        type: cascade.TYPES.BUTTON,
        group: "Alerts"
    }).on("value_updated", function(component){
        if(component.value === true)
        {
            notifyOnRule(cascade, "This is a test");
        }
    });

    cascade.components.require_component([
        "heads_temp",
        "hearts_temp",
        "tails_temp",
        "pre_heater_temp",
        "sump_temp"
    ], function (comps) {
        components = comps;
    });

    addOverheatRule(cascade, "sump_temp", 215.0, "sump_overheat_alert", "Sump Overheat");
    addOverheatRule(cascade, "heads_temp", 171.0, "heads_overheat_alert", "Heads Overheat");
    addOverheatRule(cascade, "hearts_temp", 175.0, "hearts_overheat_alert", "Hearts Overheat");
    addOverheatRule(cascade, "tails_temp", 205.0, "tails_overheat_alert", "Tails Overheat");
};

var lastProcessTime;
module.exports.loop = function (cascade) {

    if(!enableAlerts.value)
    {
        return;
    }

    var now = Date.now();

    // Only process once every 30 seconds
    if (lastProcessTime && now - lastProcessTime < 30000) {
        return;
    }

    processRules(cascade);
    lastProcessTime = now;
};