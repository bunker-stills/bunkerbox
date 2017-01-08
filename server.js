var child_process = require('child_process');

function failsafe()
{
    // Turn our D2A controllers completely off.
    var tinkerforge = require('tinkerforge');
    require("./processes/lib/tinkerforge_connection").create(function (error, ipcon) {
        if (error) {
            throw error;
        }

        ipcon.on(tinkerforge.IPConnection.CALLBACK_ENUMERATE,
            function (uid, connectedUid, position, hardwareVersion, firmwareVersion, deviceIdentifier, enumerationType) {
                if (enumerationType === tinkerforge.IPConnection.ENUMERATION_TYPE_CONNECTED || enumerationType === tinkerforge.IPConnection.ENUMERATION_TYPE_AVAILABLE) {
                    switch (deviceIdentifier) {
                        case tinkerforge.BrickletIndustrialAnalogOut.DEVICE_IDENTIFIER : {
                            var dac = new tinkerforge.BrickletIndustrialAnalogOut(uid, ipcon);
                            dac.disable();
                            dac.setVoltage(0);
                            dac.setCurrent(0);
                            break;
                        }
                    }
                }
            });

        ipcon.enumerate();
        setTimeout(ipcon.disconnect, 10000);
    });
}

function startController() {
    var controllerProcess = child_process.fork("./bunker_controller");

    controllerProcess.on('close', function () {
        console.log("There was an error. Trying to start again.");
        setTimeout(startController, 5000);
    });
}

startController();