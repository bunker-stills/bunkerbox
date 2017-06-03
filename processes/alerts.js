var emailAddresses;
var enableAlerts;

module.exports.setup = function (cascade) {

    emailAddresses = cascade.create_component({
        id: "alert_email_addresses",
        name: "Email Addresses",
        type: cascade.TYPES.TEXT,
        group : "Alerts",
        persist: true
    });

    enableAlerts = cascade.create_component({
        id: "alert_enable",
        name: "Enable Alerts",
        type: cascade.TYPES.BOOLEAN,
        group : "Alerts",
        persist: true
    });
};

module.exports.loop = function (cascade) {
    if(enableAlerts.value)
    {

    }
};