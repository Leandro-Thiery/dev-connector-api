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
const { db } = require('./db');
const { Client } = require('pg');
const app = express();


app.use(express.json({ extended: false }));

app.get('/', async (req, res) => {
    const client = new Client(db);
    await client.connect();
    const selectAll = await client.query('select MAX(id) max from transactions;');
    await client.end();
    console.log(selectAll);
    return res.send(selectAll.rows[0]);
});

app.post('/api/sendPhoto', async (req, res) => {
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

    // Recognize text in printed image from a URL
    console.log('Read printed text from URL...', printedTextSampleURL.split('/').pop());
    const printedResult = await readTextFromURL(computerVisionClient, input);
    let output = printRecText(printedResult);
    const match = output.match(/[A-Z]{1,2}\s{1}\d{1,4}\s{1}[A-Z]{1,3}/);
    if (match.length == 0) {
        return res.status(404).json({
            status: 'Failed'
        });
    }
    const licensePlate = match[0];

    try {
        // Insert INTO Database
        const client = new Client(db);
        await client.connect();
        const carUserId = await client.query(`SELECT userid FROM car WHERE platenumber ILIKE $1`, [licensePlate]);
        if (carUserId.rowCount == 0) {
            return res.status(404).json({
                status: 'Failed, car not recognised'
            });
        }
        const userId = carUserId.rows[0].userid;

        const time = new Date();
        const year = time.getFullYear();
        const month = time.getMonth() + 1;
        const day = time.getDate();
        const hour = time.getHours();
        const minute = time.getMinutes();

        const transaction = await client.query(`SELECT id, status FROM transactions WHERE platenumber ILIKE $1 ORDER BY id DESC LIMIT 1`, [licensePlate]);
        if (transaction.rows[0].id != null && (transaction.rows[0].status == 'Inside')) {
                // UPDATE OUTSIDE
                const transId = transaction.rows[0].id;
                const updateTrans = await client.query(`UPDATE transactions SET yearout = $1, 
                    monthout = $2, dayout = $3, hourout = $4, 
                    minout = $5 , status = 'Outside' WHERE id = $6`, [
                    year, month, day, hour, minute, transId
                ]);
        } else {
            const getMaxId = await client.query(`SELECT MAX(id) max FROM transactions`);
            const newId = getMaxId.rows[0].max + 1;

            await client.query(`INSERT INTO transactions 
        (id, userid, platenumber, yearin, monthin, dayin, hourin, minin, status) 
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
                newId, userId, licensePlate, year, month, day, hour, minute, 'Inside'
            ]);
        }
        await client.end();
        res.json({
            status: 'OKE',
            text: licensePlate,
            time: time.toISOString()
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            status: 'Failed'
        });
    }

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
                console.log(line.words.map(w => w.text).join(' '));
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