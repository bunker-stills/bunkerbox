var cascade = require("./cascade/cascade");
var commander = require("commander");
var package_info = require("./package.json");

var process_list = [];

if(process.env.CASCADE_PROCESSES) // Get our list of processes via ENV var first
{
    process_list = process.env.CASCADE_PROCESSES.split(",");
}

function collect(val, memo) {
    memo.push(val);
    return memo;
}

commander.version(package_info.version) // User command line args if processes are specified.
    .option('-p, --process [value]', 'process file path', collect, [])
    .parse(process.argv);

if(commander.process.length > 0)
{
    process_list = commander.process;
}

var cascade_server = new cascade({
    title : "Bunker Heising-330",
    device_id : process.env.DEVICE_ID,
    data_recorder_enabled : false,
    data_recorder_host : "influx.bunkerstills.com",
    data_recorder_port : 8089,
    web_port : process.env.WEB_PORT || 3000,
    data_storage_location : process.env.DATA_PATH,
    username : "admin",
    password : "admin",
    processes : process_list
});