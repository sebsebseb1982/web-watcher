#!/bin/sh
ancienneVersion=$(cat version.txt)
nouvelleVersion=$(echo $ancienneVersion |  awk -F. '{$NF = $NF + 1;} 1' | sed 's/ /./g')
echo $nouvelleVersion > version.txt
docker build . -t web-watcher:$nouvelleVersion