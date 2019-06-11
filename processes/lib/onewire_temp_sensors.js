// This module provides the required subset of functions from
// Tinkerforge.Bricklet1Wire.
//
// TinkerForge (TF) has released a new BrickletOneWire which does not support
// the temperature sensor specific operations that the old Bricklet1Wire did.
// To maintain support for both bricklets, this module is used to interface
// to the new Bricklet in the fashion of the old bricklet.
var Tinkerforge = require("tinkerforge");

var DS1820_FAMILY = "10";
var DS18B20_FAMILY = "28";

var DS18x20_READSCRATCH = 0xBE;
var DS18x20_WRITESCRATCH = 0x4E;
var DS18x20_CONVERT_TEMP = 0x44;

var CRC_TABLE = [
    0, 94, 188, 226, 97, 63, 221, 131, 194, 156, 126, 32, 163, 253, 31, 65,
    157, 195, 33, 127, 252, 162, 64, 30, 95, 1, 227, 189, 62, 96, 130, 220,
    35, 125, 159, 193, 66, 28, 254, 160, 225, 191, 93, 3, 128, 222, 60, 98,
    190, 224, 2, 92, 223, 129, 99, 61, 124, 34, 192, 158, 29, 67, 161, 255,
    70, 24, 250, 164, 39, 121, 155, 197, 132, 218, 56, 102, 229, 187, 89, 7,
    219, 133, 103, 57, 186, 228, 6, 88, 25, 71, 165, 251, 120, 38, 196, 154,
    101, 59, 217, 135, 4, 90, 184, 230, 167, 249, 27, 69, 198, 152, 122, 36,
    248, 166, 68, 26, 153, 199, 37, 123, 58, 100, 134, 216, 91, 5, 231, 185,
    140, 210, 48, 110, 237, 179, 81, 15, 78, 16, 242, 172, 47, 113, 147, 205,
    17, 79, 173, 243, 112, 46, 204, 146, 211, 141, 111, 49, 178, 236, 14, 80,
    175, 241, 19, 77, 206, 144, 114, 44, 109, 51, 209, 143, 12, 82, 176, 238,
    50, 108, 142, 208, 83, 13, 239, 177, 240, 174, 76, 18, 145, 207, 45, 115,
    202, 148, 118, 40, 171, 245, 23, 73, 8, 86, 180, 234, 105, 55, 213, 139,
    87, 9, 235, 181, 54, 104, 138, 212, 149, 203, 41, 119, 244, 170, 72, 22,
    233, 183, 85, 11, 136, 214, 52, 106, 43, 117, 151, 201, 74, 20, 246, 168,
    116, 42, 200, 150, 21, 75, 169, 247, 182, 232, 10, 84, 215, 137, 107, 53 ];

function onewireTempSensors(uid, ipcon) {

    var self = this;
    this.temp_sensors = null;
    this.AddressToId = {};

    this.onewire = new Tinkerforge.BrickletOneWire(uid, ipcon);


    // deviceId is the binary form used in calls to bricklet.
    // deviceAddress is the hex character form used in BunkerBox javascript code.
    this.deviceIdToAddress = function(id) {
        if (id) {
            var addr = Buffer(Float64Array.of(id).buffer).toString("hex");
            self.AddressToId[addr] = id;
            return addr;
        }
        return 0;
    };

    this.deviceAddressToId = function(address) {
        if (address) return self.AddressToId[address];
        return 0;
    };

    this.deviceFamily = function(address) {
        if (address) return address.substring(0,2);
        return "";
    };

    this.resetBus = function() {
        this.onewire.resetBus();
    };

    this.tempSetResolution = function (resolution, returnCallback, errorCallback) {
        var data = 0x7F;  // default 12-bit resolution
        if (resolution === 9) data = 0x1F;
        if (resolution === 10) data = 0x3F;
        if (resolution === 11) data = 0x5F;
        self.onewire.writeCommand(0, DS18x20_WRITESCRATCH, cb1, errorCallback);
        var cb1 = function() {self.onewire.write(0, cb2, errorCallback);};  // ALARM H (unused)
        var cb2 = function() {self.onewire.write(0, cb3, errorCallback);}; // ALARM L (unused)
        var cb3 = function() {self.onewire.write(data, returnCallback, errorCallback);}; // resolution
    };

    this.tempStartConversion = function (deviceAddress, returnCallback, errorCallback) {
        self.onewire.writeCommand(self.deviceAddressToId(deviceAddress), DS18x20_CONVERT_TEMP,
            returnCallback, errorCallback);
        return;
    };

    this.tempReadScratchPad = function (deviceAddress, num_bytes, returnCallback, errorCallback) {
        var scratchPad = [];
        var read_count = 0;
        var data_errors = 0;
        if (!num_bytes || num_bytes < 0 || num_bytes > 9) num_bytes = 9;

        var read_scratchdata = function(data, status) {

            if (read_count > 0) scratchPad[read_count-1] = data;

            if (read_count < num_bytes) {
                read_count += 1;
                self.onewire.read(read_scratchdata, errorCallback);
                return;
            }

            // If the entire scratchpad was read, verify checksum.
            if (read_count == 9) {
                var CRC = CRC_TABLE[ scratchPad[7] ^
                          CRC_TABLE[ scratchPad[6] ^
                          CRC_TABLE[ scratchPad[5] ^
                          CRC_TABLE[ scratchPad[4] ^
                          CRC_TABLE[ scratchPad[3] ^
                          CRC_TABLE[ scratchPad[2] ^
                          CRC_TABLE[ scratchPad[1] ^
                          CRC_TABLE[ scratchPad[0] ]]]]]]]];
                if (CRC != scratchPad[8]) {
                    data_errors += 1;
                    if (data_errors > 6) {
                        if (errorCallback) errorCallback(new Error("Too many 1-wire data errors."));
                        return;
                    }
                    // on data errors, re-read the scratchPad
                    self.tempReadScratchPad(deviceAddress, num_bytes, returnCallback, errorCallback);
                    return;
                }
                if (returnCallback) returnCallback(scratchPad, status);
                return;
            }
            else {
                // reset the bus to prevent further data transmissions
                self.onewire.resetBus(
                    function(status) { if (returnCallback) returnCallback(scratchPad, status);},
                    errorCallback);
                return;
            }
        };

        self.onewire.writeCommand(self.deviceAddressToId(deviceAddress), DS18x20_READSCRATCH,
            read_scratchdata, errorCallback);
        return;
    };

    // this assumes temperature conversion has been done
    this.getTemperature = function (deviceAddress, callback) {
        var num_bytes = 2;
        if (self.deviceFamily(deviceAddress) == DS1820_FAMILY) num_bytes = 7;

        self.tempReadScratchPad(deviceAddress, num_bytes,
            function (scratchPad) {
                var rawTemperature = ((scratchPad[1]) << 8) | scratchPad[0];

                if (self.deviceFamily(deviceAddress) == DS1820_FAMILY) { // DS18S20MODEL or DS1820
                    rawTemperature = ((rawTemperature & 0xFFFE) << 3) + 12 - scratchPad[6];
                }

                var temperature = rawTemperature * 0.0625;

                if (callback) callback(null, temperature);
            },
            function (error) {
                if (callback) callback(error);
            });
    };

    // NOTE: callback signature: function (error, probes)
    this.getAllTemperatures = function (callback) {

        function doError(error) {
            if (callback) callback(error);
        }

        if (!self.temp_sensors) {
            self.getAllTempSensors(function (error, devices) {
                if (error) {
                    doError(error);
                    return;
                }
                if (!devices) {
                    doError(new Error("Failed to find onewire temp sensors."));
                    return;
                }
                self.temp_sensors = devices;
                self.getAllTemperatures(callback);
                return;
            });
        }

        if (!self.temp_sensors || self.temp_sensors.length === 0) {
            if (callback) callback(null);
            return;
        }

        self.tempStartConversion(0,
            function () {

                var sensorIndex = 0;
                var sensorTemps = {};

                function doGetNextTemp() {
                    var deviceAddress = self.temp_sensors[sensorIndex];

                    self.getTemperature(deviceAddress, function (error, temperature) {
                        if (error) {
                            doError(error);
                            return;
                        }

                        sensorTemps[deviceAddress] = temperature;

                        sensorIndex++;
                        if (sensorIndex >= self.temp_sensors.length) {
                            if (callback) callback(null, sensorTemps);
                            return;
                        }

                        doGetNextTemp();
                    });
                }

                doGetNextTemp();

            },
            function(error) {
                if (callback) callback(error);
            }
        );
    };


    this.getAllTempSensors = function (callback) {
        var temp_sensors = [];
        self.onewire.searchBus(
            function(devices) {
                for (var i_device in devices) {
                    var deviceId = devices[i_device];
                    var deviceAddress = self.deviceIdToAddress(deviceId);
                    if (self.deviceFamily(deviceAddress) == DS1820_FAMILY || self.deviceFamily(deviceAddress) == DS18B20_FAMILY) {
                        temp_sensors.push(deviceAddress);
                    }
                    else {
                        // When the code is working this can be removed and other device types silently ignored.
                        if (callback)
                            callback(new Error("Device does not look like temp probe.  id = " + deviceAddress));
                    }
                }
                if (callback) callback(null, temp_sensors);
            },
            function(error) {
                if (callback) callback(error);
            }
        );
    };
}

module.exports = onewireTempSensors;
