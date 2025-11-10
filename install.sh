#!/bin/bash

# Installation script for Coder CLI
echo "Installing Coder CLI..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is required but not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "Error: npm is required but not installed. Please install Node.js (which includes npm) first."
    exit 1
fi

# Navigate to the CLI directory
cd "$(dirname "$0")" || exit 1

# Install dependencies
echo "Installing dependencies..."
npm install

# Build the CLI
echo "Building the CLI tool..."
npm run build

if [ $? -ne 0 ]; then
    echo "Error: Failed to build the CLI tool."
    exit 1
fi

# Check if we're in a global installation context
if [ "$1" = "-g" ] || [ "$1" = "--global" ]; then
    echo "Installing globally..."
    npm install -g .
    
    if [ $? -eq 0 ]; then
        echo "Coder CLI installed globally! You can now run 'coder-cli' from anywhere."
        echo "Run 'coder-cli init' to configure your AI backend settings."
    else
        echo "Error: Failed to install Coder CLI globally."
        exit 1
    fi
else
    echo "Built successfully! To install globally, run: npm install -g ."
    echo "Or you can run the CLI directly with: npx tsx src/index.ts"
fi

echo "Installation complete!"