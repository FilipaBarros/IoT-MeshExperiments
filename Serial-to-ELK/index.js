var SerialPort = require('serialport');
var yargs = require('yargs');
var elasticsearch = require('elasticsearch');

// Log Message Types
var NETWORK_MAP = 0;
var RECEIVED_MSG = 1;


// Command Arguments
var argv = yargs
    .usage('Usage: $0 -port [str] -baud [num] -server [str]')
    .default('port', '/dev/ttyUSB0')
    .default('baud', 115200)
    .default('server', '192.168.102.55')
    .argv;


// Serial Port Parser
var Readline = SerialPort.parsers.Readline;
var port = new SerialPort(argv.port, { baudRate: argv.baud });
var parser = port.pipe(Readline({ delimiter: '\n' }));

// ElasticSearch client
var client = new elasticsearch.Client({
    host: argv.server + ':9200'
    //log: ''
});

// Check if the ElasticSearch server is up
client.ping({
    requestTimeout: 5000,
}, function (error) {
    if (error) {
        console.error('ElasticSearch cluster is down!');
        process.exit(1);
    } else {
        console.log('All is well');
    }
}
);

var format_r = function (currentScope, nodes, edges, prevId) {

    for (let i = 0; i < currentScope.length; i++) {
        if (currentScope[i] !== undefined && currentScope[i].hasOwnProperty('nodeId')) { // Check if the new 'currentScope' still has a 'nodeId' object
           
            var data_node = {id: currentScope[i].nodeId};

            var data_edge = {
                id: prevId + '-' + currentScope[i].nodeId,
                weight: 1,
                source: prevId,
                target: currentScope[i].nodeId
            }


        
            nodes.push(data_node);//'{data: { id: ' + currentScope[i].nodeId + '}}');

            edges.push(data_edge);//'{data: { id: ' + prevId + '-' + currentScope[i].nodeId + ', weight: 1, source: ' + prevId + ', target: ' + currentScope[i].nodeId + '}}');

            if (currentScope[i].hasOwnProperty('subs')) {
                format_r(currentScope[i].subs, nodes, edges, currentScope[i].nodeId);
            }
        }
    }
}

// Network State Message Formatter
var format = function (parsedMsg) {
    let formmatedMsg,
        nodes = [],
        edges = [],
        currentScope;

    if (parsedMsg.hasOwnProperty('self')) {
        var data = {};

        data.id = parsedMsg.self;

        nodes.push(data);//'{data: { id: ' + parsedMsg.self + '}}');

        currentScope = parsedMsg.body;
        format_r(currentScope, nodes, edges, parsedMsg.self);
    }
    var elements = {};

    elements.nodes = nodes;
    elements.edges = edges;
    //formmatedMsg = "{elements: { nodes: [" + nodes + "], edges: [" + edges + "]}}";
    console.log(elements)
    return JSON.stringify(elements);
}

// Consumer
var consumer = function (entry) {


    entry = entry.replace(/\t/g," ");

    try {
        var parsedMsg = JSON.parse(entry);
        console.log(entry);

        var ELKindex; // index to be used in the ElasticSearch submission
        switch (parsedMsg.msgtype) {
            case NETWORK_MAP:
                ELKindex = 'network';
                parsedMsg = format(parsedMsg);
                break;
            case RECEIVED_MSG:
                ELKindex = 'messages-' + parsedMsg.self;
                break;
            default:
                ELKindex = 'unformatted';
                break;
        }

        client.index({
            index: ELKindex,
            type: 'log',
            //id: '1',
            body: {
                message: parsedMsg,
                date: new Date().toISOString()
            }
        }, function (error, response) {
            if (error) {
                console.log('ElasticSearch ERROR: ' + error);
            }
            else {
                //console.log(response);
            }
        });
    } catch (e) {
        console.log('Not valid JSON msg: ' + entry);
    }

}

parser.on('data', consumer);