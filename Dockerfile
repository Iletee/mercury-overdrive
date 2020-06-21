FROM node:lts-alpine

# Install tools required for project
# Run `docker build --no-cache .` to update dependencies


# List project dependencies with Gopkg.toml and Gopkg.lock
# These layers are only re-built when Gopkg files are updated
WORKDIR /node/src/project/


# Copy the entire project and build it
# This layer is rebuilt when a file changes in the project directory
COPY . /node/src/project/
RUN chmod +x /node/src/project/entrypoint.sh
RUN npm install

# This results in a single layer image

ENTRYPOINT ["/node/src/project/"]
CMD ["entrypoint.sh"]
