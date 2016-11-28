var MIN_TEMP = 70;
var MAX_TEMP = 220;
var MAX_HUE = 200;

function map(value, in_min, in_max, out_min, out_max) {
    var new_value = (value - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
    return Math.min(out_max, Math.max(out_min, new_value));
}

function set_column_temp_display_temp(id, temp) {
    var color_element = document.getElementById(id);
    var h_value = MAX_HUE - map(temp, MIN_TEMP, MAX_TEMP, 0, MAX_HUE);
    color_element.style.stopColor = "hsl(" + h_value + ",100%,50%)";
}

function update_flow_state(wash_input, pump_on) {
    if (wash_input) {
        document.getElementById("flow-lines-color").style.fill = "rgb(241, 184, 153)";
    }
    else {
        document.getElementById("flow-lines-color").style.fill = "rgb(139, 217, 255)";
    }

    if (pump_on) {
        document.getElementById("pump-icon").style.animation = "pump-spin 2s linear infinite";
        document.getElementById("pre-heater-entry-pipe").style.fill = "url(#flow-lines-up)";
        document.getElementById("pre-heater-exit-pipe").style.fill = "url(#flow-lines-down-right)";
        document.getElementById("pump-entry-pipe").style.fill = "url(#flow-lines-down-right)";

        document.getElementById("water-input").style.fill = wash_input ? "#fff" : "url(#flow-lines-right)";
        document.getElementById("feed-input").style.fill = wash_input ? "url(#flow-lines-down)" : "#fff";
    }
    else {
        document.getElementById("pump-icon").style.animation = "none";
        document.getElementById("pre-heater-entry-pipe").style.fill = "#fff";
        document.getElementById("pre-heater-exit-pipe").style.fill = "#fff";
        document.getElementById("pump-entry-pipe").style.fill = "#fff";
        document.getElementById("water-input").style.fill = "#fff";
        document.getElementById("feed-input").style.fill = "#fff";
    }
    /*
     #pre-heater-entry-pipe {
     fill: url(#flow-lines-up);
     }

     #pre-heater-exit-pipe, #pump-entry-pipe {
     fill: url(#flow-lines-down-right);
     }

     #water-input {
     fill: url(#flow-lines-right);
     }

     #feed-input
     {
     fill: url(#flow-lines-down);
     }
     */
}

function set_main_heater_output() {

}

set_column_temp_display_temp("pre-heater-temp-color", 110);
set_column_temp_display_temp("heads-temp-color", 168);
set_column_temp_display_temp("hearts-temp-color", 172);
set_column_temp_display_temp("tails-temp-color", 185);
set_column_temp_display_temp("sump-temp-color", 211);

var svgns = "http://www.w3.org/2000/svg";

var iso_left = document.createElementNS(svgns, "g");
iso_left.id = "iso-left-face";
document.getElementById("process-diagram").appendChild(iso_left);

var pump_icon = document.createElementNS(svgns, "rect");
pump_icon.id = "pump-icon";
pump_icon.setAttributeNS(null, "width", "50");
pump_icon.setAttributeNS(null, "height", "50");
pump_icon.setAttributeNS(null, "x", "550");
pump_icon.setAttributeNS(null, "y", "355");
document.getElementById("iso-left-face").appendChild(pump_icon);

mqtt_client = mqtt.connect(
    "ws://localhost:3000",
    {
        username: "admin",
        password: "admin"
    }
);

mqtt_client.on("error", function (error) {

    loading_indicator(false);

    if (error.message.indexOf("Not authorized") != -1) {
        disconnect_mqtt_client();
        display_login_screen();
    }
});

mqtt_client.on("connect", function () {
    // Get all the info for our components
    mqtt_client.subscribe("read/+/+/+/detail");

    // Get any log updates
    mqtt_client.subscribe("log/#")
});

mqtt_client.on("close", function () {
});

mqtt_client.on("message", function (topic, payload) {

    if(topic.indexOf("read/") === 0)
    {
        payload = JSON.parse(payload.toString());
        //update_component_ui(payload);
    }
    else if(topic.indexOf("log/") === 0)
    {
    }
});