#! /bin/bash

set -euo pipefail

# This is used for testing browser live sessions with local URLs
# Refer: https://www.browserstack.com/docs/local-testing 
LOCAL_SERVER_URL="http://localhost:8000"

# TODO: download ios app
function download_apps() {
    # Skip if Calculator.apk already exists
    if [ -f "Calculator.apk" ]; then
        echo "Calculator.apk already exists, skipping download"
    else
        local android_app_url="https://www.browserstack.com/app-automate/sample-apps/android/Calculator.apk"
        curl -o Calculator.apk $android_app_url
    fi

    # Skip if BrowserStack-SampleApp.ipa already exists
    if [ -f "BrowserStack-SampleApp.ipa" ]; then
        echo "BrowserStack-SampleApp.ipa already exists, skipping download"
    else
        local ios_app_url="https://www.browserstack.com/app-automate/sample-apps/ios/BrowserStack-SampleApp.ipa"
        curl -o BrowserStack-SampleApp.ipa $ios_app_url
    fi
}

function ensure_deps() {
    # ensure jq is installed
    if ! command -v jq &> /dev/null; then
        echo "jq could not be found, please install it"
        exit 1
    fi

    # Check if BrowserStack credentials are set
    if [ -z "${_BROWSERSTACK_USERNAME:-}" ]; then
        echo "_BROWSERSTACK_USERNAME environment variable is not set"
        echo "Please set it by running: export _BROWSERSTACK_USERNAME=your_username"
        exit 1
    fi

    if [ -z "${_BROWSERSTACK_ACCESS_KEY:-}" ]; then
        echo "_BROWSERSTACK_ACCESS_KEY environment variable is not set" 
        echo "Please set it by running: export _BROWSERSTACK_ACCESS_KEY=your_access_key"
        exit 1
    fi

    download_apps
}

function list_tools() {
    echo "Listing tools..."
    npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list | jq '.tools[].name'
}

function testO11Y() {
    echo "Testing O11Y..."
    testO11YInvalidBuild
    testO11YValidBuild
}

function log_success() {
    echo -e "\033[32mTest passed: $1\033[0m"
}

function log_failure() {
    echo -e "\033[31mTest failed: $1\033[0m"
}

function testO11YInvalidBuild() {
    response=$(npx @modelcontextprotocol/inspector  -e BROWSERSTACK_USERNAME=$_BROWSERSTACK_USERNAME -e BROWSERSTACK_ACCESS_KEY=$_BROWSERSTACK_ACCESS_KEY --cli node dist/index.js --method tools/call --tool-name getFailuresInLastRun --tool-arg buildName='asds' --tool-arg projectName='asdas')
    if echo "$response" | grep -q "Not Found"; then
        log_success "Response indicates build not found"
    else
        log_failure "Expected 'not found' error but got different response"
        echo "Response was: $response"
        exit 1
    fi
}

function testO11YValidBuild() {
    response=$(npx @modelcontextprotocol/inspector  -e BROWSERSTACK_USERNAME=$_BROWSERSTACK_USERNAME -e BROWSERSTACK_ACCESS_KEY=$_BROWSERSTACK_ACCESS_KEY --cli node dist/index.js --method tools/call --tool-name getFailuresInLastRun --tool-arg buildName='demo-application' --tool-arg projectName='Default Project')

    if echo "$response" | grep -q "failures caused by 1 unique errors"; then
        log_success "Response indicates valid build"
    else
        log_failure "Expected failures caused by 1 unique errors but got different response"
        echo "Response was: $response"
        exit 1
    fi
}

function testAppLive() {
    echo "Testing App Live..."
    testAppLiveAndroid
    # # echo "Sleeping for 5 seconds before starting iOS test..."
    # # sleep 5
    # testAppLiveiOS
}

function testAppLiveAndroid() {
    realpath=$(realpath "./Calculator.apk")
    response=$(npx @modelcontextprotocol/inspector -e BROWSERSTACK_USERNAME=$_BROWSERSTACK_USERNAME -e BROWSERSTACK_ACCESS_KEY=$_BROWSERSTACK_ACCESS_KEY --cli node dist/index.js --method tools/call --tool-name runAppLiveSession --tool-arg desiredPlatform='android' --tool-arg desiredPlatformVersion='12.0' --tool-arg appPath="$realpath" --tool-arg desiredPhone='Samsung Galaxy S22')

    echo "Response was: $response"
    if echo "$response" | grep -q "Successfully started a session"; then
        log_success "Successfully started Android app live session"
    else
        log_failure "Failed to start Android app live session"
        echo "Response was: $response"
        exit 1
    fi
}
function testAppLiveiOS() {
    realpath=$(realpath "./BrowserStack-SampleApp.ipa")
    response=$(npx @modelcontextprotocol/inspector -e BROWSERSTACK_USERNAME=$_BROWSERSTACK_USERNAME -e BROWSERSTACK_ACCESS_KEY=$_BROWSERSTACK_ACCESS_KEY --cli node dist/index.js --method tools/call --tool-name runAppLiveSession --tool-arg desiredPlatform='ios' --tool-arg desiredPlatformVersion='17.0' --tool-arg appPath="$realpath" --tool-arg desiredPhone='iPhone 15 Pro Max')

    echo "Response was: $response"
    if echo "$response" | grep -q "Successfully started a session"; then
        log_success "Successfully started iOS app live session"
    else
        log_failure "Failed to start iOS app live session"
        echo "Response was: $response"
        exit 1
    fi
}

function testBrowserLive() {
    echo "Testing Browser Live..."
    testBrowserLiveChrome
    sleep 3
    # testBrowserLiveChromeLocalURL
}

function testBrowserLiveChrome() {
    desiredURL="https://www.whatsmybrowser.org/"
    response=$(npx @modelcontextprotocol/inspector \
        -e BROWSERSTACK_USERNAME=$_BROWSERSTACK_USERNAME \
        -e BROWSERSTACK_ACCESS_KEY=$_BROWSERSTACK_ACCESS_KEY \
        --cli node dist/index.js \
        --method tools/call \
        --tool-name runBrowserLiveSession \
        --tool-arg platformType='desktop' \
        --tool-arg desiredBrowser='chrome' \
        --tool-arg desiredOSVersion='11' \
        --tool-arg desiredURL=$desiredURL \
        --tool-arg desiredOS='Windows' \
        --tool-arg desiredBrowserVersion='133.0')
    if echo "$response" | grep -q "Session started"; then
        log_success "Successfully started Chrome browser session"
    else
        log_failure "Failed to start Chrome browser session"
        echo "Response was: $response"
        exit 1
    fi
}

function ensureLocalServerRunning() {
    # check if local server is running
    if ! curl -s $LOCAL_SERVER_URL > /dev/null; then
        log_failure "Local server is not running, please run 'python3 -m http.server 8000' and try again"
        exit 1
    fi
}

function testBrowserLiveChromeLocalURL() {
    desiredURL=$LOCAL_SERVER_URL

    response=$(npx @modelcontextprotocol/inspector -e BROWSERSTACK_USERNAME=$_BROWSERSTACK_USERNAME -e BROWSERSTACK_ACCESS_KEY=$_BROWSERSTACK_ACCESS_KEY --cli node dist/index.js --method tools/call --tool-name runBrowserLiveSession --tool-arg desiredBrowser='Chrome' --tool-arg desiredOSVersion='11' --tool-arg desiredURL="$desiredURL" --tool-arg desiredOS='Windows' --tool-arg desiredBrowserVersion='133.0')

    if echo "$response" | grep -q "Successfully started a browser session"; then
        log_success "Successfully started Chrome browser session"
    else
        log_failure "Failed to start Chrome browser session"
        echo "Response was: $response"
        exit 1
    fi
}

function testAccessibility() {
    echo "Testing Accessibility..."
    testAccessibilityScan
}

function testAccessibilityScan() {
    scanName="test-mcp-accessibility-scan-$(date +%s)"

    response=$(npx @modelcontextprotocol/inspector -e BROWSERSTACK_USERNAME=$_BROWSERSTACK_USERNAME -e BROWSERSTACK_ACCESS_KEY=$_BROWSERSTACK_ACCESS_KEY --cli node dist/index.js --method tools/call --tool-name startAccessibilityScan --tool-arg name="$scanName" --tool-arg pageURL='https://www.example.com/')

    if echo "$response" | grep -q "Successfully queued accessibility scan"; then
        log_success "Successfully queued accessibility scan"
    else
        log_failure "Failed to queue accessibility scan"
        echo "Response was: $response"
        exit 1
    fi
}

ensure_deps
list_tools

echo -e "\n\t Starting manual tests...\n\n"

# testO11Y
# sleep 5
testAppLive
# sleep 5
# testBrowserLive
sleep 5
# testAccessibility
