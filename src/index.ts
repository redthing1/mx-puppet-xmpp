/*
Copyright 2020 mx-puppet-xmpp
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import {
	PuppetBridge,
	IPuppetBridgeRegOpts,
	Log,
	IRetData,
	Util,
	IProtocolInformation,
} from "mx-puppet-bridge";
import * as commandLineArgs from "command-line-args";
import * as commandLineUsage from "command-line-usage";
import * as fs from "fs";
import * as yaml from "js-yaml";
import { Xmpp } from "./xmpp";
import { Client } from "./client";

const log = new Log("XmppPuppet:index");

const commandOptions = [
	{ name: "register", alias: "r", type: Boolean },
	{ name: "registration-file", alias: "f", type: String },
	{ name: "config", alias: "c", type: String },
	{ name: "help", alias: "h", type: Boolean },
];
const options = Object.assign({
	"register": false,
	"registration-file": "xmpp-registration.yaml",
	"config": "config.yaml",
	"help": false,
}, commandLineArgs(commandOptions));

if (options.help) {
	// tslint:disable-next-line:no-console
	console.log(commandLineUsage([
		{
			header: "Matrix Xmpp Puppet Bridge",
			content: "A matrix puppet bridge for Xmpp",
		},
		{
			header: "Options",
			optionList: commandOptions,
		},
	]));
	process.exit(0);
}

const protocol: IProtocolInformation = {
	features: {
		image: false,
		audio: false,
		file: false,
		edit: false,
		reply: false,
		globalNamespace: true,
	},
	id: "xmpp",
	displayname: "Xmpp",
	externalUrl: "https://xmpp.com/",
};

const puppet = new PuppetBridge(options["registration-file"], options.config, protocol);

if (options.register) {
	// okay, all we have to do is generate a registration file
	puppet.readConfig(false);
	try {
		puppet.generateRegistration({
			prefix: "_xmpppuppet_",
			id: "xmpp-puppet",
			url: `http://${puppet.Config.bridge.bindAddress}:${puppet.Config.bridge.port}`,
		});
	} catch (err) {
		// tslint:disable-next-line:no-console
		console.log("Couldn't generate registration file:", err);
	}
	process.exit(0);
}

async function run() {
	await puppet.init();
	const xmpp = new Xmpp(puppet);
	puppet.on("puppetNew", xmpp.newPuppet.bind(xmpp));
	puppet.on("puppetDelete", xmpp.deletePuppet.bind(xmpp));
	puppet.on("message", xmpp.handleMatrixMessage.bind(xmpp));
	puppet.on("edit", xmpp.handleMatrixEdit.bind(xmpp));
	puppet.on("reply", xmpp.handleMatrixReply.bind(xmpp));
	puppet.on("redact", xmpp.handleMatrixRedact.bind(xmpp));
	puppet.on("image", xmpp.handleMatrixImage.bind(xmpp));
	puppet.on("audio", xmpp.handleMatrixAudio.bind(xmpp));
	puppet.on("file", xmpp.handleMatrixFile.bind(xmpp));
	puppet.setCreateUserHook(xmpp.createUser.bind(xmpp));
	puppet.setCreateRoomHook(xmpp.createRoom.bind(xmpp));
	puppet.setGetDmRoomIdHook(xmpp.getDmRoom.bind(xmpp));
	puppet.setListUsersHook(xmpp.listUsers.bind(xmpp));
	puppet.setListRoomsHook(xmpp.listRooms.bind(xmpp));
	puppet.setGetUserIdsInRoomHook(xmpp.getUserIdsInRoom.bind(xmpp));
	puppet.setGetDescHook(async (puppetId: number, data: any): Promise<string> => {
		let s = "Xmpp";
		if (data.username) {
			s += ` as \`${data.username}\``;
		}
		return s;
	});
	puppet.setGetDataFromStrHook(async (str: string): Promise<IRetData> => {
		const retData = {
			success: false,
		} as IRetData;
		const TOKENS_TO_EXTRACT = 3;
		// const [username, password, wsUrl] = str.split(/ (.+)/, TOKENS_TO_EXTRACT);
		const [username, password, wsUrl] = str.split(" ", TOKENS_TO_EXTRACT);
		const data: any = {
			username,
			password,
			wsUrl,
		};
		try {
			log.verbose(`trying to log in as ${username}, ${password} to ${wsUrl}`);
			const client = new Client(username, password, wsUrl);
			await client.connect();
			data.state = client.getState;
			setTimeout(async () => {
				await client.disconnect();
			}, 2000);
		} catch (err) {
			log.verbose("Failed to log in as new user, perhaps the password is wrong?");
			log.silly(err);
			retData.error = "Username or password wrong";
			return retData;
		}
		retData.success = true;
		retData.data = data;
		return retData;
	});
	puppet.setBotHeaderMsgHook((): string => {
		return "Xmpp Puppet Bridge";
	});
	await puppet.start();
}

// tslint:disable-next-line:no-floating-promises
run();
