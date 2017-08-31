#!/bin/sh

git clone https://github.com/obmarg/libsysconfcpus.git
cd libsysconfcpus
./configure --prefix=$TRAVIS_BUILD_DIR/sysconfcpus
make && make install
cd ..
