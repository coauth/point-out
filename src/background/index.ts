import { storage } from "../storage";
import browser from "webextension-polyfill";
import merge from "ts-deepmerge";
import { policyValidator, type TPolicyAction, policyParser, type TPolicyMessage } from "src/components/helpers/PolicyHelper";
import appConfig from "src/config/config";
import type { TMessageExchange } from "src/components/types/MessageExchangeType";
import type { TMessageCategory } from "src/components/types/MessageCategoryTypes";

let configuration = new Map<string, Map<string,TPolicyMessage>>();

let messageStore = new Map<number, Array<TPolicyAction>>();


const cleanUpOnTabClose = ((tabId: number,): void => {
    messageStore.delete(tabId);
});

browser.tabs.onRemoved.addListener(cleanUpOnTabClose);

browser.webNavigation.onBeforeNavigate.addListener((details) => {
    const { tabId, url, timeStamp, frameId } = details;

    let policyActions: Array<TPolicyAction> = policyValidator(url,configuration);
    if(policyActions.length!=0){
        messageStore.set(tabId, policyActions);
        for(let policyAction of policyActions){
            if(policyAction.action==='block_page'){
                browser.tabs.update(tabId, { url: browser.runtime.getURL('src/blocked/blocked.html') });
                break;
            }
        }
    }
});

const processContentScriptsListener = ((request: any, sender, sendResponse): void => {

    if ((request as TMessageCategory).category) {
        let category = request as TMessageCategory;
        if (category.category === 'REQUEST_MESSAGE') {
            sendResponse({ response: messageStore.get(sender.tab.id) });
        }
    }

});

const addContentScriptsMessageListener = () => {
    browser.runtime.onMessage.addListener(processContentScriptsListener);
}

browser.runtime.onInstalled.addListener(() => {
    addContentScriptsMessageListener();
    loadOrUpdateConfiguration();
    browser.alarms.create('Fetch API', { periodInMinutes: appConfig.policyConfig.policyFetchInternalInSeconds });
});


browser.alarms.onAlarm.addListener((alarm) => {
    loadOrUpdateConfiguration();
});

async function fetchConfigurationFromAPI(url: string): Promise<JSON> {
    return fetch(url, {cache: "no-store"}).then((response) => {
        if (response.status == 200) {
            const responseJson = response.json();
            return Promise.resolve(responseJson);
        } else {
            return Promise.resolve({});
        }
    }).catch((reason) => {
        return Promise.resolve({});
    });
}

async function loadOrUpdateConfiguration() {
    const internalAPIJsonValue = await fetchConfigurationFromAPI(appConfig.policyConfig.internalUrl);
    const externalAPIJsonValue = await fetchConfigurationFromAPI(appConfig.policyConfig.externalUrl);
    const mergeResult = merge.withOptions(
        { mergeArrays: true },internalAPIJsonValue, externalAPIJsonValue);

    const parsedPolicy=policyParser(mergeResult);

    console.log("fecth API completed",parsedPolicy);
    
    if (!isEmptyObject(parsedPolicy)) {
        saveConfigToStorage(parsedPolicy);
    } else {
        loadConfigFromStorage();
    }
}

async function loadConfigFromStorage(): Promise<void> {
    return browser.storage.local.get(["config"]).then((result) => {
        configuration = result.key;
        return Promise.resolve();
    });
}

async function saveConfigToStorage(value: Map<string,Map<string,TPolicyMessage>>) {
    if (!isEmptyObject(value)) {
        browser.storage.local.set({ "config": value }).then(() => {
            configuration = value;
        });
    }

}

function isEmptyObject(value: Map<string,Map<string,TPolicyMessage>>): boolean {
    if (JSON.stringify(value) === '{}') return true;
    else return false;
}



