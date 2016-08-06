module.exports.setup = function (cascade) {
    cascade.create_component({
        id: "emergency_stop",
        name: "Emergency Stop",
        group : "emergency_stop",
        class: "emergency_stop",
        type: cascade.TYPES.BOOLEAN
    });

    cascade.create_component({
        id: "emergency_stop_reason",
        name: "Emergency Stop Reason",
        group : "emergency_stop",
        class: "emergency_stop_reason"
    });
};