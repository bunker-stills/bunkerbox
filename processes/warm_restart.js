var path = require("path");
var fs = require('fs');
var _ = require("underscore");

var warmRestartComponent;

module.exports.setup = function (cascade) {

    var restartFilePath = path.join(cascade.cascade_server.config.data_storage_location, "warm_restart.json");
    var restartConfig;

    try {
        restartConfig = require(restartFilePath);
        fs.unlinkSync(restartFilePath);
    }
    catch(e)
    {
    }

    // Ignore if the restart hasn't happened within 2 minutes of shutting down
    if(restartConfig && restartConfig.date && Date.now() - restartConfig.date <= 120000)
    {
        function setComponents()
        {
            _.each(restartConfig.components, function(value, componentID){
                var component = cascade.components.all_current[componentID];

                if(component)
                {
                    component.value = value;
                }
            });
        }

        // Wait 15 seconds for everything to come online before we commit our values
        setTimeout(function(){
            // Do it twice to make sure nothing resets something else
            setComponents();
            setComponents();
        }, 15000);
    }

    warmRestartComponent = cascade.create_component({
        id: "allow_warm_restart",
        name: "Allow Warm Restart",
        group: "run",
        type: cascade.TYPES.BOOLEAN,
        value: false
    }).on("value_updated", function(){

        if(warmRestartComponent.value === true)
        {
            var newRestartConfig = {
                date: Date.now(),
                components: {}
            };

            _.each(cascade.components.all_current, function (component) {
                if(!component.read_only && component.id !== "allow_warm_restart")
                {
                    newRestartConfig.components[component.id] = component.value;
                }
            });

            fs.writeFile(restartFilePath, JSON.stringify(newRestartConfig), function(error){});
        }
        else
        {
            fs.unlinkSync(restartFilePath);
        }

    });
};

module.exports.loop = function (cascade) {

    // Don't allow us to allow warm restarts for more than 20 seconds. We want it to be done shortly before restarting.
    if(warmRestartComponent.value === true && warmRestartComponent.seconds_since_last_updated() >= 20)
    {
        warmRestartComponent.value = false;
    }

};