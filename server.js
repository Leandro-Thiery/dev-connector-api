'use strict';
const express = require('express');

const async = require('async');
const fs = require('fs');
const https = require('https');
const path = require("path");
const createReadStream = require('fs').createReadStream;
const sleep = require('util').promisify(setTimeout);
const ComputerVisionClient = require('@azure/cognitiveservices-computervision').ComputerVisionClient;
const ApiKeyCredentials = require('@azure/ms-rest-js').ApiKeyCredentials;
const app = express();


app.use(express.json({ extended: false }));

app.get('/', (req, res) => {
    res.send('API Running');
});

app.post('/api/send-photo', async (req, res) => {
    console.log(req.body);
    if (!req.body.image) {
        return res.status(400).json({
            status: 'Failed'
        });
    }
    /**
     * AUTHENTICATE
     * This single client is used for all examples.
     */
    const key = '1b560f36645c486c88d3b78dc33e73c1';
    const endpoint = 'https://spark-cv.cognitiveservices.azure.com/';

    const computerVisionClient = new ComputerVisionClient(
        new ApiKeyCredentials({ inHeader: { 'Ocp-Apim-Subscription-Key': key } }), endpoint);

    const printedTextSampleURL = req.body.image;

    var input = Buffer.from(printedTextSampleURL, 'base64');
    console.log(input);
    // Status strings returned from Read API. NOTE: CASING IS SIGNIFICANT.
    // Before Read 3.0, these are "Succeeded" and "Failed"

    // Recognize text in printed image from a URL
    console.log('Read printed text from URL...', printedTextSampleURL.split('/').pop());
    const printedResult = await readTextFromURL(computerVisionClient, input);
    let output = printRecText(printedResult);

    const match = output.match(/[A-Z]{1,2}\s{1}\d{1,4}\s{1}[A-Z]{1,3}/);
    res.json({
        status: 'OKE',
        text: match[0]
    });
});


async function readTextFromURL(client, url) {
    // To recognize text in a local image, replace client.read() with readTextInStream() as shown:
    let result = await client.readInStream(url);
    // Operation ID is last path segment of operationLocation (a URL)
    let operation = result.operationLocation.split('/').slice(-1)[0];
    const STATUS_SUCCEEDED = "succeeded";
    // Wait for read recognition to complete
    // result.status is initially undefined, since it's the result of read
    while (result.status !== STATUS_SUCCEEDED) { await sleep(1000); result = await client.getReadResult(operation); }
    return result.analyzeResult.readResults; // Return the first page of result. Replace [0] with the desired page if this is a multi-page file such as .pdf or .tiff.
}

function printRecText(readResults) {
    let text = '';
    console.log('Recognized text:');
    for (const page in readResults) {
        if (readResults.length > 1) {
            console.log(`==== Page: ${page}`);
        }
        const result = readResults[page];
        if (result.lines.length) {
            for (const line of result.lines) {
                text += (line.words.map(w => w.text).join(' ')) + '\n';
                console.log(line.words.map(w => w.text).join(' '))
            }
        }
        else { console.log('No recognized text.'); }
    }
    return text;
}

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server Started on port: ${PORT}`);
});