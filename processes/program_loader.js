module.exports.setup = function(cascade)
{
    var loaderComponent = cascade.create_component({
        id: "program_loader",
        name: "Program to load",
        group: "Program Loader",
        type: cascade.TYPES.OPTIONS,
        persist: true,
        info: {
            options: ["None", "Experimenter"]
        },
        value: "None"
    });

    switch(loaderComponent.value)
    {
        case "Experimenter" :
        {
            cascade.require_process("experimenter");
            break;
        }
    }
};