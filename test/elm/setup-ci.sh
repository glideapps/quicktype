#!/bin/bash

if [ ! -d sysconfcpus/bin ];
then
    git clone https://github.com/obmarg/libsysconfcpus.git; 
    cd libsysconfcpus;
    ./configure --prefix=$TRAVIS_BUILD_DIR/sysconfcpus;
    make && make install;
    cd ..;
fi

$TRAVIS_BUILD_DIR/sysconfcpus/bin/sysconfcpus -n 2 elm-make --yes