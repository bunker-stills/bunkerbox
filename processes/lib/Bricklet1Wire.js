/* ***********************************************************
 * This file was automatically generated on 2017-07-27.      *
 *                                                           *
 * JavaScript Bindings Version 2.0.15                        *
 *                                                           *
 * If you have a bugfix for this file and want to commit it, *
 * please fix the bug in the generator. You can find a link  *
 * to the generators git repository on tinkerforge.com       *
 *************************************************************/

var Device = require("tinkerforge/lib/Device");

Bricklet1Wire.DEVICE_IDENTIFIER = 401;
Bricklet1Wire.DEVICE_DISPLAY_NAME = '1Wire Bricklet';

Bricklet1Wire.FID_WIRE_RESET = 1;
Bricklet1Wire.FID_WIRE_RESET_SEARCH = 2;
Bricklet1Wire.FID_WIRE_SEARCH = 3;
Bricklet1Wire.FID_WIRE_WRITE_BIT = 4;
Bricklet1Wire.FID_WIRE_READ_BIT = 5;
Bricklet1Wire.FID_WIRE_WRITE_BYTE = 6;
Bricklet1Wire.FID_WIRE_READ_BYTE = 7;
Bricklet1Wire.FID_WIRE_SELECT = 8;
Bricklet1Wire.FID_WIRE_SKIP = 9;
Bricklet1Wire.FID_SET_DS2482_CONFIG = 10;
Bricklet1Wire.FID_GET_DS2482_CONFIG = 11;
Bricklet1Wire.FID_RESET_DS2482 = 12;
Bricklet1Wire.FID_TEMP_START_CONVERSION = 13;
Bricklet1Wire.FID_TEMP_READ_SCRATCH = 14;
Bricklet1Wire.FID_TEMP_SET_RESOLUTION = 15;

function Bricklet1Wire(uid, ipcon) {

    var self = this;

    /*
    Creates an object with the unique device ID *uid* and adds it to
    the IP Connection *ipcon*.
    */
    Device.call(this, this, uid, ipcon);
    Bricklet1Wire.prototype = Object.create(Device);
    this.APIVersion = [2, 0, 0];
    this.responseExpected[Bricklet1Wire.FID_WIRE_RESET] = Device.RESPONSE_EXPECTED_ALWAYS_TRUE;
    this.responseExpected[Bricklet1Wire.FID_WIRE_RESET_SEARCH] = Device.RESPONSE_EXPECTED_ALWAYS_TRUE;
    this.responseExpected[Bricklet1Wire.FID_WIRE_SEARCH] = Device.RESPONSE_EXPECTED_ALWAYS_TRUE;
    this.responseExpected[Bricklet1Wire.FID_WIRE_WRITE_BIT] = Device.RESPONSE_EXPECTED_ALWAYS_TRUE;
    this.responseExpected[Bricklet1Wire.FID_WIRE_READ_BIT] = Device.RESPONSE_EXPECTED_ALWAYS_TRUE;
    this.responseExpected[Bricklet1Wire.FID_WIRE_WRITE_BYTE] = Device.RESPONSE_EXPECTED_ALWAYS_TRUE;
    this.responseExpected[Bricklet1Wire.FID_WIRE_READ_BYTE] = Device.RESPONSE_EXPECTED_ALWAYS_TRUE;
    this.responseExpected[Bricklet1Wire.FID_WIRE_SELECT] = Device.RESPONSE_EXPECTED_ALWAYS_TRUE;
    this.responseExpected[Bricklet1Wire.FID_WIRE_SKIP] = Device.RESPONSE_EXPECTED_ALWAYS_TRUE;
    this.responseExpected[Bricklet1Wire.FID_SET_DS2482_CONFIG] = Device.RESPONSE_EXPECTED_ALWAYS_TRUE;
    this.responseExpected[Bricklet1Wire.FID_GET_DS2482_CONFIG] = Device.RESPONSE_EXPECTED_ALWAYS_TRUE;
    this.responseExpected[Bricklet1Wire.FID_RESET_DS2482] = Device.RESPONSE_EXPECTED_ALWAYS_TRUE;
    this.responseExpected[Bricklet1Wire.FID_TEMP_START_CONVERSION] = Device.RESPONSE_EXPECTED_ALWAYS_TRUE;
    this.responseExpected[Bricklet1Wire.FID_TEMP_READ_SCRATCH] = Device.RESPONSE_EXPECTED_ALWAYS_TRUE;
    this.responseExpected[Bricklet1Wire.FID_TEMP_SET_RESOLUTION] = Device.RESPONSE_EXPECTED_ALWAYS_TRUE;

    this.wireReset = function (returnCallback, errorCallback) {
        this.ipcon.sendRequest(this, Bricklet1Wire.FID_WIRE_RESET, [], '', '', returnCallback, errorCallback);
    };

    this.wireResetSearch = function (returnCallback, errorCallback) {
        this.ipcon.sendRequest(this, Bricklet1Wire.FID_WIRE_RESET_SEARCH, [], '', '', returnCallback, errorCallback);
    };

    this.wireSearch = function (returnCallback, errorCallback) {
        this.ipcon.sendRequest(this, Bricklet1Wire.FID_WIRE_SEARCH, [], '', 'B8 ?', function (address, moreAvailable) {
            if (returnCallback) returnCallback(Buffer.from(address).toString('hex'), moreAvailable);
        }, errorCallback);
    };

    this.wireWriteBit = function (bitToWrite, returnCallback, errorCallback) {
        this.ipcon.sendRequest(this, Bricklet1Wire.FID_WIRE_WRITE_BIT, [bitToWrite], '?', '', returnCallback, errorCallback);
    };

    this.wireReadBit = function (returnCallback, errorCallback) {
        this.ipcon.sendRequest(this, Bricklet1Wire.FID_WIRE_READ_BIT, [], '', '?', returnCallback, errorCallback);
    };

    this.wireWriteByte = function (byteToWrite, returnCallback, errorCallback) {
        this.ipcon.sendRequest(this, Bricklet1Wire.FID_WIRE_WRITE_BYTE, [byteToWrite], 'B', '', returnCallback, errorCallback);
    };

    this.wireReadByte = function (returnCallback, errorCallback) {
        this.ipcon.sendRequest(this, Bricklet1Wire.FID_WIRE_READ_BYTE, [], '', 'B', returnCallback, errorCallback);
    };

    this.wireSelect = function (deviceAddress, returnCallback, errorCallback) {
        var deviceAddressBytes = Buffer.from(deviceAddress, "hex");
        this.ipcon.sendRequest(this, Bricklet1Wire.FID_WIRE_SELECT, [deviceAddressBytes], 'B8', '', returnCallback, errorCallback);
    };

    this.wireSkip = function (returnCallback, errorCallback) {
        this.ipcon.sendRequest(this, Bricklet1Wire.FID_WIRE_SKIP, [], '', '', returnCallback, errorCallback);
    };

    this.resetBus = function (returnCallback, errorCallback) {
        this.ipcon.sendRequest(this, Bricklet1Wire.FID_RESET_DS2482, [], '', '', returnCallback, errorCallback);
    };

    this.tempSetResolution = function (resolution, returnCallback, errorCallback) {
        this.ipcon.sendRequest(this, Bricklet1Wire.FID_TEMP_SET_RESOLUTION, [resolution], 'B', '', returnCallback, errorCallback);
    };

    this.tempStartConversion = function (returnCallback, errorCallback) {
        this.ipcon.sendRequest(this, Bricklet1Wire.FID_TEMP_START_CONVERSION, [], '', '', returnCallback, errorCallback);
    };

    this.tempReadScratchPad = function (deviceAddress, returnCallback, errorCallback) {
        var deviceAddressBytes = Buffer.from(deviceAddress, "hex");
        this.ipcon.sendRequest(this, Bricklet1Wire.FID_TEMP_READ_SCRATCH, [deviceAddressBytes], 'B8', 'B9', returnCallback, errorCallback);
    };

    this.getTemperature = function (deviceAddress, callback) {
        self.tempReadScratchPad(deviceAddress, function (scratchPad) {

            var rawTemperature = ((scratchPad[1]) << 8) | scratchPad[0];

            if (deviceAddress[0] === 0x10) { // DS18S20MODEL or DS1820
                rawTemperature = ((rawTemperature & 0xFFFE) << 3) + 12 - scratchPad[6];
            }

            var temperature = rawTemperature * 0.0625;

            if (callback) callback(null, temperature);
        }, function (error) {
            if (callback) callback(error);
        });
    };

    this.getAllTemperatures = function (callback) {

        function doError(error) {
            if (callback) callback(error);
        }

        self.getConnectedDevices(function (error, devices) {

            if (error) {
                doError(error);
                return;
            }

            if (!devices || devices.length === 0) {
                if (callback) callback(null);
                return;
            }

            self.tempStartConversion(function () {

                var deviceIndex = 0;
                var deviceTemps = {};

                function doGetNextTemp() {
                    var deviceAddress = devices[deviceIndex];

                    self.getTemperature(deviceAddress, function (error, temperature) {
                        if (error) {
                            doError(error);
                            return;
                        }

                        deviceTemps[deviceAddress] = temperature;

                        deviceIndex++;

                        if (deviceIndex >= devices.length) {
                            if (callback) callback(null, deviceTemps);
                            return;
                        }

                        doGetNextTemp();
                    });
                }

                doGetNextTemp();

            }, doError);
        });
    };

    this.getConnectedDevices = function (callback) {
        self.wireResetSearch(function () {

            var devices = [];
            var searchCount = 0;

            function doSearch() {

                searchCount++;

                if (searchCount > 64) {
                    if (callback) callback(new Error("Too many devices found."));
                    return;
                }

                self.wireSearch(
                    function (address, moreAvailable) {

                        if (moreAvailable) {
                            devices.push(address);
                            doSearch();
                        }
                        else {
                            if (callback) callback(null, devices);
                        }
                    },
                    function (error) {
                        if (callback) callback(error);
                    }
                );
            }

            doSearch();

        }, function (error) {
            if (callback) callback(error);
        });
    };

    this.getIdentity = function (returnCallback, errorCallback) {
        /*
        Returns the UID, the UID where the Bricklet is connected to,
        the position, the hardware and firmware version as well as the
        device identifier.

        The position can be 'a', 'b', 'c' or 'd'.

        The device identifier numbers can be found :ref:`here <device_identifier>`.
        |device_identifier_constant|
        */
        this.ipcon.sendRequest(this, Bricklet1Wire.FUNCTION_GET_IDENTITY, [], '', 's8 s8 c B3 B3 H', returnCallback, errorCallback);
    };
}

module.exports = Bricklet1Wire;