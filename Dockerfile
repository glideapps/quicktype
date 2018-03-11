FROM ubuntu:xenial

ENV workdir /app

RUN mkdir ${workdir}
WORKDIR ${workdir}

RUN apt-get update --fix-missing
RUN apt-get install curl git apt-transport-https --assume-yes

# Install Swift
RUN curl -o swift.tar.gz https://swift.org/builds/swift-4.0.3-release/ubuntu1604/swift-4.0.3-RELEASE/swift-4.0.3-RELEASE-ubuntu16.04.tar.gz
RUN tar -zxf swift.tar.gz
RUN rm swift.tar.gz
ENV PATH="${workdir}/swift-4.0.3-RELEASE-ubuntu16.04/usr/bin:${PATH}"

# Add nodejs package source
RUN curl -sL https://deb.nodesource.com/setup_8.x | bash -

# Add .NET core package sources
RUN curl https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > microsoft.gpg  
RUN mv microsoft.gpg /etc/apt/trusted.gpg.d/microsoft.gpg
RUN sh -c 'echo "deb [arch=amd64] https://packages.microsoft.com/repos/microsoft-ubuntu-xenial-prod xenial main" > /etc/apt/sources.list.d/dotnetdev.list'

RUN apt-get update
RUN apt-get install nodejs maven default-jdk clang binutils golang-go --assume-yes
RUN apt-get install dotnet-sdk-2.0.0 --assume-yes

# Install Boost for C++
RUN apt-get install libboost-all-dev --assume-yes

# Install Rust
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Tool to limit elm-make cores
RUN git clone https://github.com/obmarg/libsysconfcpus.git
RUN cd libsysconfcpus && ./configure && make && make install

# Ruby
RUN apt-get install ruby --assume-yes
RUN gem install bundler

ENV PATH="${workdir}/node_modules/.bin:${PATH}"

COPY . .

ENV CI=true
RUN npm install --unsafe-perm