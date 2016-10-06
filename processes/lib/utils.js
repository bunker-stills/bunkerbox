module.exports.calculate_water_boiling_point = function(pressure_in_mbar) {
    // Calculate our boiling point
    var baroInHG = pressure_in_mbar * 0.02953;
    var boilingPoint = Math.log(baroInHG) * 49.160999 + 44.932;

    return parseFloat(boilingPoint.toFixed(3));
};