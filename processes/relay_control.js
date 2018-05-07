var relay_controls = {};

function process_duty_cycle(relay_control)
{
    if(relay_control.enable.value === false)
    {
        return;
    }

    var cycle_time_in_ms = relay_control.cycle_length.value * 1000.0;

    // If anything less than 1 second, let's ignore it
    if(cycle_time_in_ms <= 1000)
    {
        return;
    }

    var ms_on = (relay_control.on_percent.value / 100.0) * cycle_time_in_ms;
    var ms_off = cycle_time_in_ms - ms_on;

    if(ms_on > 0 && relay_control.relay_component)
    {
        relay_control.relay_component.value = true; // Start our cycle
    }

    relay_control.timer = setTimeout(function(){

        if(ms_off > 0 && relay_control.relay_component)
        {
            relay_control.relay_component.value = false; // Stop our cycle
        }

        relay_control.timer = setTimeout(function(){
            process_duty_cycle(relay_control); // Start all over again
        }, ms_off);

    }, ms_on);
}

function stop_timer(reflux_control)
{
    if(reflux_control.timer)
    {
        clearTimeout(reflux_control.timer);
        delete reflux_control.timer;
    }

    if(reflux_control.relay_component)
    {
        reflux_control.relay_component.value = false;
    }
}

function create_relay_controller(cascade, relay_id, id, description, displayOrder)
{
    var relay_control = {};

    cascade.components.require_component(relay_id, function(component){
        relay_control.relay_component = component;
    });

    relay_control.enable = cascade.create_component({
        id: id + "_enable",
        name: description + " Enable",
        group : "relay duty cycle",
        display_order: displayOrder + 0,
        class: "enable",
        type: cascade.TYPES.BOOLEAN,
        units: "seconds",
        value: false
    });
    relay_control.enable.on("value_updated", function(){
        stop_timer(relay_control);

        if(relay_control.enable.value)
        {
            process_duty_cycle(relay_control);
        }
    });

    relay_control.cycle_length = cascade.create_component({
        id: id + "_cycle_length",
        name: description + " Cycle Length",
        group : "relay duty cycle",
        display_order: displayOrder + 1,
        class: "cycle_length",
        type: cascade.TYPES.NUMBER,
        units: "seconds",
        value: 20,
        persist: true
    });
    relay_control.cycle_length.on("value_updated", function(){
        stop_timer(relay_control);
        if(relay_control.enable.value)
        {
            process_duty_cycle(relay_control);
        }
    });

    relay_control.on_percent = cascade.create_component({
        id: id + "_on_percent",
        name: description + " On Percent",
        group : "relay duty cycle",
        display_order: displayOrder + 2,
        type: cascade.TYPES.NUMBER,
        units: cascade.UNITS.PERCENTAGE,
        value: 0
    });

    process_duty_cycle(relay_control);

    relay_controls[id] = relay_control;
}

module.exports.setup = function (cascade) {
    create_relay_controller(cascade, "relay_0", "relay_0_duty_cycle", "Relay 0 Duty Cycle", 10);
    create_relay_controller(cascade, "relay_1", "relay_1_duty_cycle", "Relay 1 Duty Cycle", 20);
    create_relay_controller(cascade, "relay_2", "relay_2_duty_cycle", "Relay 2 Duty Cycle", 30);
    create_relay_controller(cascade, "relay_3", "relay_3_duty_cycle", "Relay 3 Duty Cycle", 40);
};