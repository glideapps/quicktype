# To push this repo, log in as "schani" on DockerHub, and
#   docker tag IMAGE-ID schani/quicktype
#   docker push schani/quicktype

FROM ubuntu:bionic-20220105

ENV workdir /app

RUN mkdir ${workdir}
WORKDIR ${workdir}

RUN apt-get -y update --fix-missing
RUN apt-get -y install curl git apt-transport-https --assume-yes

# Install Pike
RUN apt-get -y update
RUN apt-get -y install pike8.0-full --assume-yes

# Tool to limit elm-make cores
RUN git clone https://github.com/obmarg/libsysconfcpus.git
RUN cd libsysconfcpus && ./configure && make && make install

# Ruby
RUN apt-get -y install ruby --assume-yes
# This must be the same version as what's in `Gemfile.lock`
RUN gem install bundler -v 1.16.1

# Dart
RUN apt-get -y install apt-transport-https
RUN curl -o /tmp/dart.deb "https://storage.googleapis.com/dart-archive/channels/stable/release/2.14.4/linux_packages/dart_2.14.4-1_amd64.deb" && dpkg -i /tmp/dart.deb && rm /tmp/dart.deb

# Crystal
RUN curl -sL "https://keybase.io/crystal/pgp_keys.asc" | apt-key add -
RUN echo "deb https://dist.crystal-lang.org/apt crystal main" | tee /etc/apt/sources.list.d/crystal.list
RUN apt-get -y update
RUN apt-get -y install crystal --assume-yes


ENV PATH="${workdir}/node_modules/.bin:${PATH}"

COPY . .

ENV CI=true
RUN npm install --unsafe-perm
RUN npm run tslint
