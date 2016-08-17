var reflux_controls = {};

function process_reflux_cycle(reflux_control)
{
    var cycle_time_in_ms = reflux_control.cycle_length.value * 1000.0;

    // If anything less than 1 second, let's ignore it
    if(cycle_time_in_ms <= 1000)
    {
        return;
    }

    var ms_on = (reflux_control.reflux_percent.value / 100.0) * cycle_time_in_ms;
    var ms_off = cycle_time_in_ms - ms_on;

    if(ms_on > 0 && reflux_control.relay_component)
    {
        reflux_control.relay_component.value = true; // Start our reflux
    }

    setTimeout(function(){
        if(ms_off > 0 && reflux_control.relay_component)
        {
            reflux_control.relay_component.value = false; // Stop our reflux
        }

        setTimeout(function(){
            process_reflux_cycle(reflux_control); // Start all over again
        }, ms_off);

    }, ms_on);
}

function create_reflux_controller(cascade, relay_id, id, description)
{
    var reflux_control = {};

    cascade.components.require_component(relay_id, function(component){
        reflux_control.relay_component = component;
    });

    reflux_control.cycle_length = cascade.create_component({
        id: id + "_cycle_length",
        name: description + " Cycle Length",
        group : "reflux_control",
        class: "cycle_length",
        type: cascade.TYPES.NUMBER,
        units: "seconds",
        value: 5,
        persist: true
    });
    reflux_control.cycle_length.on("value_updated", function(){
        if(reflux_control.timer)
        {
            clearTimeout(reflux_control.timer);
            delete reflux_control.timer;
            process_reflux_cycle(reflux_control);
        }
    });

    reflux_control.reflux_percent = cascade.create_component({
        id: id + "_percent",
        name: description + " Percentage",
        group : "reflux_control",
        class: "reflux_percent",
        type: cascade.TYPES.NUMBER,
        units: "%",
        value: 100
    });

    process_reflux_cycle(reflux_control);

    reflux_controls[id] = reflux_control;
}

module.exports.setup = function (cascade) {
    cascade.require_process("process_temps");

    create_reflux_controller(cascade, "hearts_reflux_relay", "hearts_reflux", "Hearts Reflux");
};