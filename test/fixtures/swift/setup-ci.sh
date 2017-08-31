#!/bin/bash

if [ ! -d $HOME/swift/usr/bin ]; then
    pushd $HOME
    curl -o swift.tar.gz https://swift.org/builds/swift-3.1.1-release/ubuntu1404/swift-3.1.1-RELEASE/swift-3.1.1-RELEASE-ubuntu14.04.tar.gz
    tar -zxf swift.tar.gz
    rm swift.tar.gz

    rm -rf swift # remove old swift folder (empty if exists)
    mv swift-3.1.1-RELEASE-ubuntu14.04 swift
    pwd
    ls swift
    popd
fi
