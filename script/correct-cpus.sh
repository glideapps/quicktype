#!/bin/bash

# On CI, this sets the number of CPUs to 2
# Travis incorrectly reports 8, slowing down
# elm and purescript compilers

if [ ! $CI ];
then
    bash $@
    exit 0
fi

if [ ! -d sysconfcpus/bin ];
then
    git clone https://github.com/obmarg/libsysconfcpus.git; 
    cd libsysconfcpus;
    ./configure --prefix=$TRAVIS_BUILD_DIR/sysconfcpus;
    make && make install;
    cd ..;
fi

$TRAVIS_BUILD_DIR/sysconfcpus/bin/sysconfcpus -n 2 $@