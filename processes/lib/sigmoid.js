module.exports.riseTo = function(x, min, max, length)
{
    if(x >= length)
    {
        return max;
    }
    else if(x <= min)
    {
        return min;
    }

    return (max - min) / (1 + Math.exp((15 / length) * (-x + (length / 2)))) + min;
};