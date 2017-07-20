#!/bin/bash

declare -a urls=("https://blockchain.info/latestblock"
                 "https://www.ncdc.noaa.gov/cag/time-series/us/110/00/tavg/ytd/12/1895-2016.json"
                )

cd test/csharp
dotnet restore

for url in "${urls[@]}"
do
    node ../../bin/quicktype.js $url > QuickType.cs
    echo "Attempting to build and parse" $url  
    dotnet run $url
done


