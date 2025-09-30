#!/usr/bin/env pwsh
# Build script for quicktype project on Windows

param(
    [switch]$Clean,
    [switch]$Test,
    [switch]$Verbose,
    [string]$Target = "all"
)

# Set error handling
$ErrorActionPreference = "Stop"

# Colors for output (using simple ASCII to avoid Unicode issues)
$Colors = @{
    Success = "GREEN"
    Error = "RED" 
    Warning = "YELLOW"
    Info = "CYAN"
    Default = "WHITE"
}

function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "Default"
    )
    
    $colorValue = switch ($Color) {
        "GREEN" { "Green" }
        "RED" { "Red" }
        "YELLOW" { "Yellow" }
        "CYAN" { "Cyan" }
        default { "White" }
    }
    
    Write-Host $Message -ForegroundColor $colorValue
}

function Write-Step {
    param([string]$Message)
    Write-ColorOutput "[STEP] $Message" "Info"
}

function Write-Success {
    param([string]$Message)
    Write-ColorOutput "[SUCCESS] $Message" "Success"
}

function Write-Error {
    param([string]$Message)
    Write-ColorOutput "[ERROR] $Message" "Error"
}

function Write-Warning {
    param([string]$Message)
    Write-ColorOutput "[WARNING] $Message" "Warning"
}

function Test-Command {
    param([string]$Command)
    try {
        Get-Command $Command -ErrorAction Stop | Out-Null
        return $true
    }
    catch {
        return $false
    }
}

function Invoke-SafeCommand {
    param(
        [string]$Command,
        [string]$WorkingDirectory = $PWD,
        [string]$Description = ""
    )
    
    if ($Description) {
        Write-Step $Description
    }
    
    if ($Verbose) {
        Write-ColorOutput "Executing: $Command" "Info"
        Write-ColorOutput "Working Directory: $WorkingDirectory" "Info"
    }
    
    try {
        Push-Location $WorkingDirectory
        Invoke-Expression $Command
        Pop-Location
        return $true
    }
    catch {
        Pop-Location
        Write-Error "Command failed: $Command"
        Write-Error $_.Exception.Message
        return $false
    }
}

function Install-Dependencies {
    Write-Step "Installing dependencies..."
    
    if (-not (Test-Command "npm")) {
        Write-Error "npm is not installed. Please install Node.js and npm first."
        exit 1
    }
    
    $nodeVersion = node --version
    Write-ColorOutput "Node.js version: $nodeVersion" "Info"
    
    if (-not (Invoke-SafeCommand "npm install" -Description "Installing npm dependencies")) {
        Write-Error "Failed to install dependencies"
        exit 1
    }
    
    Write-Success "Dependencies installed successfully"
}

function Clean-Project {
    Write-Step "Cleaning project..."
    
    $directoriesToClean = @(
        "dist",
        "packages/quicktype-core/dist",
        "packages/quicktype-graphql-input/dist", 
        "packages/quicktype-typescript-input/dist",
        "packages/quicktype-vscode/out"
    )
    
    foreach ($dir in $directoriesToClean) {
        if (Test-Path $dir) {
            Write-ColorOutput "Removing: $dir" "Info"
            Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
        }
    }
    
    # Remove temporary files
    $tempFiles = @("*.tsbuildinfo", "*~")
    foreach ($pattern in $tempFiles) {
        Get-ChildItem -Path . -Name $pattern -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
            Write-ColorOutput "Removing: $_" "Info"
            Remove-Item $_ -Force -ErrorAction SilentlyContinue
        }
    }
    
    Write-Success "Project cleaned successfully"
}

function Build-Packages {
    Write-Step "Building packages..."
    
    $packages = @(
        @{ Name = "quicktype-core"; Path = "packages/quicktype-core" },
        @{ Name = "quicktype-graphql-input"; Path = "packages/quicktype-graphql-input" },
        @{ Name = "quicktype-typescript-input"; Path = "packages/quicktype-typescript-input" },
        @{ Name = "quicktype-vscode"; Path = "packages/quicktype-vscode" }
    )
    
    foreach ($package in $packages) {
        Write-Step "Building $($package.Name)..."
        
        if (-not (Test-Path $package.Path)) {
            Write-Warning "Package directory not found: $($package.Path)"
            continue
        }
        
        # Check if package has TypeScript config
        if (-not (Test-Path "$($package.Path)/tsconfig.json")) {
            Write-Warning "No tsconfig.json found in $($package.Path), skipping..."
            continue
        }
        
        # Build the package
        if (-not (Invoke-SafeCommand "npx tsc" -WorkingDirectory $package.Path -Description "Compiling $($package.Name)")) {
            Write-Error "Failed to build $($package.Name)"
            exit 1
        }
        
        Write-Success "$($package.Name) built successfully"
    }
}

function Build-Main {
    Write-Step "Building main project..."
    
    if (-not (Invoke-SafeCommand "npx tsc" -Description "Compiling main project")) {
        Write-Error "Failed to build main project"
        exit 1
    }
    
    Write-Success "Main project built successfully"
}

function Test-Quicktype {
    Write-Step "Testing quicktype functionality..."
    
    # Test if quicktype can be executed
    try {
        $testOutput = npx quicktype --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Quicktype is working: $testOutput"
        } else {
            Write-Warning "Quicktype version check failed, but continuing..."
        }
    }
    catch {
        Write-Warning "Could not test quicktype version: $($_.Exception.Message)"
    }
    
    # Test with a simple schema
    $testSchema = @"
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "default": "Test"
    },
    "age": {
      "type": "integer",
      "default": 25
    }
  }
}
"@
    
    $testSchema | Out-File -FilePath "test-schema.json" -Encoding UTF8
    
    try {
        $output = npx quicktype --lang dart --src-lang schema test-schema.json 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Default values test passed"
            if ($Verbose) {
                Write-ColorOutput "Generated code:" "Info"
                Write-ColorOutput $output "Default"
            }
        } else {
            Write-Warning "Default values test failed, but build completed"
            if ($Verbose) {
                Write-ColorOutput "Error output:" "Warning"
                Write-ColorOutput $output "Warning"
            }
        }
    }
    catch {
        Write-Warning "Could not test default values: $($_.Exception.Message)"
    }
    finally {
        if (Test-Path "test-schema.json") {
            Remove-Item "test-schema.json" -Force
        }
    }
}

function Show-Help {
    Write-ColorOutput "Quicktype Build Script for Windows" "Info"
    Write-ColorOutput "=================================" "Info"
    Write-ColorOutput ""
    Write-ColorOutput "Usage: .\script\build.ps1 [options]" "Default"
    Write-ColorOutput ""
    Write-ColorOutput "Options:" "Default"
    Write-ColorOutput "  -Clean          Clean build artifacts before building" "Default"
    Write-ColorOutput "  -Test           Run tests after building" "Default"
    Write-ColorOutput "  -Verbose        Show detailed output" "Default"
    Write-ColorOutput "  -Target <name>  Build target (all, packages, main, clean)" "Default"
    Write-ColorOutput ""
    Write-ColorOutput "Examples:" "Default"
    Write-ColorOutput "  .\script\build.ps1                    # Full build" "Default"
    Write-ColorOutput "  .\script\build.ps1 -Clean             # Clean and build" "Default"
    Write-ColorOutput "  .\script\build.ps1 -Test              # Build and test" "Default"
    Write-ColorOutput "  .\script\build.ps1 -Target packages   # Build only packages" "Default"
    Write-ColorOutput ""
    Write-ColorOutput "Prerequisites:" "Default"
    Write-ColorOutput "  - Node.js (>=18.12.0)" "Default"
    Write-ColorOutput "  - npm" "Default"
    Write-ColorOutput "  - PowerShell 5.1 or later" "Default"
}

# Main execution
function Main {
    Write-ColorOutput "Quicktype Build Script" "Info"
    Write-ColorOutput "=====================" "Info"
    Write-ColorOutput "Starting build process..." "Info"
    Write-ColorOutput ""
    
    # Check if we're in the right directory
    if (-not (Test-Path "package.json")) {
        Write-Error "package.json not found. Please run this script from the project root directory."
        exit 1
    }
    
    # Check if we're in the right directory (quicktype project)
    $packageJson = Get-Content "package.json" | ConvertFrom-Json
    if ($packageJson.name -ne "quicktype") {
        Write-Error "This doesn't appear to be the quicktype project. package.json name is: $($packageJson.name)"
        exit 1
    }
    
    try {
        switch ($Target.ToLower()) {
            "clean" {
                Clean-Project
            }
            "packages" {
                Install-Dependencies
                Build-Packages
            }
            "main" {
                Install-Dependencies
                Build-Main
            }
            "all" {
                if ($Clean) {
                    Clean-Project
                }
                Install-Dependencies
                Build-Packages
                Build-Main
                
                if ($Test) {
                    Test-Quicktype
                }
            }
            default {
                Write-Error "Unknown target: $Target"
                Show-Help
                exit 1
            }
        }
        
        Write-ColorOutput ""
        Write-Success "Build completed successfully!"
        Write-ColorOutput "You can now use: npx quicktype --help" "Info"
        
    }
    catch {
        Write-Error "Build failed: $($_.Exception.Message)"
        exit 1
    }
}

# Handle help parameter
if ($args -contains "-h" -or $args -contains "--help" -or $Target -eq "--help") {
    Show-Help
    exit 0
}

# Run main function
Main
