var temp;

module.exports.setup = function (cascade) {

    setTimeout(function(){
        temp = cascade.create_component({
            id: "some_temp",
            name: "Some Temp",
            units: cascade.UNITS.C,
            group : "sensors",
            class: "raw_temperature",
            read_only : true,
            type: cascade.TYPES.NUMBER
        });
    }, 10000);

};

module.exports.loop = function (cascade) {
    if(temp)
    {
        temp.value = Date.now();
    }
};