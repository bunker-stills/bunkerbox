process.chdir(__dirname);

var cascade = require("@bunkerstills/cascade");
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

var users;

if(process.env.USERS)
{
    try { users = JSON.parse(process.env.USERS) } catch(e){}
}

var cascade_server = new cascade({
    title : "Bunker Heising-330",
    device_id : process.env.RESIN_DEVICE_NAME_AT_INIT || process.env.DEVICE_ID,
    web_port : Number(process.env.WEB_PORT) || 3000,
    mqtt_port : Number(process.env.MQTT_PORT) || 1883,
    enable_mqtt: true,
    data_storage_location : process.env.DATA_PATH,
    processes : process_list,
    run_loop_time_in_seconds : Number(process.env.LOOP_SECONDS) || 1,
    users : users
});