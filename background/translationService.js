"use strict";

//TODO dividir em varios requests
//TODO Especificar o source lang com page no idioma do paragrafo (dividindo as requests)

var translationService = {}

{
    let googleTranslateTKK = "448487.932609646"

    function escapeHTML(unsafe) {
        return unsafe
            .replace(/\&/g, "&amp;")
            .replace(/\</g, "&lt;")
            .replace(/\>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/\'/g, "&#39;");
    }

    function unescapeHTML(unsafe) {
        return unsafe
            .replace(/\&amp;/g, "&")
            .replace(/\&lt;/g, "<")
            .replace(/\&gt;/g, ">")
            .replace(/\&quot;/g, "\"")
            .replace(/\&\#39;/g, "'");
    }

    function shiftLeftOrRightThenSumOrXor(num, optString) {
        for (var i = 0; i < optString.length - 2; i += 3) {
            var acc = optString.charAt(i + 2);
            if ('a' <= acc) {
                acc = acc.charCodeAt(0) - 87;
            } else {
                acc = Number(acc);
            }
            if (optString.charAt(i + 1) == '+') {
                acc = num >>> acc;
            } else {
                acc = num << acc;
            }
            if (optString.charAt(i) == '+') {
                num += acc & 4294967295;
            } else {
                num ^= acc;
            }
        }
        return num;
    }

    function transformQuery(query) {
        var bytesArray = [];
        var idx = [];
        for (var i = 0; i < query.length; i++) {
            var charCode = query.charCodeAt(i);

            if (128 > charCode) {
                bytesArray[idx++] = charCode;
            } else {
                if (2048 > charCode) {
                    bytesArray[idx++] = charCode >> 6 | 192;
                } else {
                    if (55296 == (charCode & 64512) && i + 1 < query.length && 56320 == (query.charCodeAt(i + 1) & 64512)) {
                        charCode = 65536 + ((charCode & 1023) << 10) + (query.charCodeAt(++i) & 1023);
                        bytesArray[idx++] = charCode >> 18 | 240;
                        bytesArray[idx++] = charCode >> 12 & 63 | 128;
                    } else {
                        bytesArray[idx++] = charCode >> 12 | 224;
                    }
                    bytesArray[idx++] = charCode >> 6 & 63 | 128;
                }
                bytesArray[idx++] = charCode & 63 | 128;
            }

        }
        return bytesArray;
    }
    
    function calcHash(query, windowTkk) {
        var tkkSplited = windowTkk.split('.');
        var tkkIndex = Number(tkkSplited[0]) || 0;
        var tkkKey = Number(tkkSplited[1]) || 0;
    
        var bytesArray = transformQuery(query);
    
        var encondingRound = tkkIndex;
        for (var i = 0; i < bytesArray.length; i++) {
            encondingRound += bytesArray[i];
            encondingRound = shiftLeftOrRightThenSumOrXor(encondingRound, '+-a^+6');
        }
        encondingRound = shiftLeftOrRightThenSumOrXor(encondingRound, '+-3^+b+-f');
        
        encondingRound ^= tkkKey;
        if (encondingRound <= 0) {
            encondingRound = (encondingRound & 2147483647) + 2147483648;
        }

        var normalizedResult  = encondingRound % 1000000;
        return normalizedResult .toString() + '.' + (normalizedResult  ^ tkkIndex);
    }

    const googleTranslationInProgress = {}
    const yandexTranslationInProgress = {}

    function getTranslationInProgress(translationService, targetLanguage) {
        let translationInProgress 
        if (translationService === "yandex") {
            translationInProgress = yandexTranslationInProgress
        } else {
            translationInProgress = googleTranslationInProgress
        }

        if (!translationInProgress[targetLanguage]) {
            translationInProgress[targetLanguage] = []
        }

        return translationInProgress[targetLanguage]
    }

    translationService.google = {}
    translationService.yandex = {}

    async function translateHTML(translationService, targetLanguage, translationServiceURL, sourceArray, requestBody, textParamName, translationProgress, dontSaveInCache=false) {
        const thisTranslationProgress = []
        const requests = []

        for (const str of sourceArray) {
            const transInfo = translationProgress.find(value => value.source === str)
            if (transInfo) {
                thisTranslationProgress.push(transInfo)
            } else {
                let translated
                try {
                    translated = await translationCache.get(translationService, str, targetLanguage)
                } catch (e) {
                    console.error(e)
                }
                let newTransInfo
                if (translated) {
                    newTransInfo = {
                        source: str,
                        translated: translated,
                        status: "complete"
                    }
                } else {
                    newTransInfo = {
                        source: str,
                        translated: null,
                        status: "translating"
                    }
                    
                    if (requests.length < 1 || requests[requests.length-1].requestBody.length > 800) {
                        requests.push({requestBody, fullSource: "", transInfos: []})
                    }

                    requests[requests.length-1].requestBody += "&" + textParamName + "=" + encodeURIComponent(str)
                    requests[requests.length-1].fullSource += str
                    requests[requests.length-1].transInfos.push(newTransInfo)
                }

                translationProgress.push(newTransInfo)
                thisTranslationProgress.push(newTransInfo)
            }
        }

        if (requests.length > 0) {
            for (const idx in requests) {
                let tk = ""
                if (translationService === "google") {
                    tk = calcHash(requests[idx].fullSource, googleTranslateTKK)
                }

                const http = new XMLHttpRequest
                http.open("POST", translationServiceURL + tk)
                http.setRequestHeader("Content-Type", "application/x-www-form-urlencoded")
                http.responseType = "json"
                http.send(requests[idx].requestBody)
                http.onload = e => {
                    const response = http.response
                    let responseJson
                    if (translationService === "yandex") {
                        responseJson = response.text
                    } else {
                        if (typeof response[0] == "string") {
                            responseJson = response
                        } else {
                            responseJson = response.map(value => value[0])
                        }
                    }

                    requests[idx].transInfos.forEach((transInfo, index) => {
                        try {
                            if (responseJson[index]) {
                                transInfo.status = "complete"
                                transInfo.translated = responseJson[index]
                                
                                if (!dontSaveInCache) {
                                    try {
                                        //TODO ERRO AQUI FAZ DA LENTIDAO
                                        translationCache.set(translationService, transInfo.source, transInfo.translated, targetLanguage)
                                    } catch (e) {
                                        console.error(e)
                                    }
                                }
                            } else {
                                transInfo.status = "error"
                            }
                        } catch (e) {
                            transInfo.status = "error"
                            console.error(e)
                        }
                    })
                    return responseJson
                }
                http.onerror = e => {
                    requests[idx].transInfos.forEach(transInfo => {
                        transInfo.status = "error"
                    })
                    console.error(e)
                }
            }
        }

        const promise =  new Promise((resolve, reject) => {
            let iterationsCount = 0
            function waitForTranslationFinish() {
                let isTranslating = false
                for (let info of thisTranslationProgress) {
                    if (info.status === "translating") {
                        isTranslating = true
                        break
                    }
                }
                if (iterationsCount < 100) {
                    if (isTranslating) {
                        setTimeout(waitForTranslationFinish, 100)
                    } else {
                        resolve(thisTranslationProgress)
                    }
                } else {
                    reject()
                }
            }
            waitForTranslationFinish()
        })

        try {
            return await promise
        } catch (e) {
            console.error(e)
        }
    }

    // nao funciona bem por problemas em detectar o idioma do texto
    async function fixSouceArray(sourceArray3d) {
        const newSourceArray3d = []
        const fixIndexesMap = []
        
        for (const i in sourceArray3d) {
            newSourceArray3d.push([])
            fixIndexesMap.push(parseInt(i))

            const sourceArray = sourceArray3d[i]
            let prevDetectedLanguage = null
            for (const j in sourceArray) {
                const text = sourceArray[j]
                const detectedLanguage = await new Promise(resolve => {
                    chrome.i18n.detectLanguage(text, result => {
                        if (result && result.languages && result.languages.length > 0) {
                            resolve(result.languages[Object.keys(result.languages)[0]].language)
                        } else {
                            resolve(null)
                        }
                    })
                })
                if (detectedLanguage && prevDetectedLanguage && detectedLanguage !== prevDetectedLanguage && newSourceArray3d[newSourceArray3d.length-1].length > 0) {
                    newSourceArray3d.push([text])
                    fixIndexesMap.push(parseInt(i))
                } else {
                    newSourceArray3d[newSourceArray3d.length-1].push(text)
                }
                prevDetectedLanguage = detectedLanguage
            }
        }
        
        return [newSourceArray3d, fixIndexesMap]
    }

    function fixResultArray(resultArray3d, fixIndexesMap) {
        const newResultArray3d = []
        
        let idx = 0
        for (const index of fixIndexesMap) {
            if (!newResultArray3d[index]) {
                newResultArray3d[index] = []
            }
            if (resultArray3d[idx]) {
                for (const text of resultArray3d[idx]) {
                    newResultArray3d[index].push(text)
                }
                idx++
            } else {
                console.error("resultArray is undefined")
                break
            }
        }

        if (newResultArray3d[newResultArray3d.length-1].length < 1) {
            newResultArray3d.pop()
        }

        return newResultArray3d
    }

    // async para fix
    translationService.google.translateHTML = function (_sourceArray3d, targetLanguage, dontSaveInCache=false, preseveTextFormat=false) {
        if (targetLanguage == "zh") {
            targetLanguage = "zh-CN"
        }

        //const [sourceArray3d, fixIndexesMap] = await fixSouceArray(_sourceArray3d)
        const sourceArray3d = _sourceArray3d

        const sourceArray = sourceArray3d.map(sourceArray => {
            sourceArray = sourceArray.map(value => escapeHTML(value))
            if (sourceArray.length > 1) {
                sourceArray = sourceArray.map((value, index) => "<a i=" + index + ">" + value + "</a>")
            }
            if (preseveTextFormat) {
                return "<pre>" + sourceArray.join("") + "</pre>"
            }
            return sourceArray.join("")
        })

        const requestBody = ""
        return translateHTML(
            "google",
            targetLanguage,
            `https://translate.googleapis.com/translate_a/t?anno=3&client=te&v=1.0&format=html&sl=auto&tl=` + targetLanguage + "&tk=",
            sourceArray,
            requestBody,
            "q",
            getTranslationInProgress("google", targetLanguage),
            dontSaveInCache
        )
        .then(thisTranslationProgress => {
            const results = thisTranslationProgress.map(value => value.translated)
            const resultArray3d = []
            
            for (let i in results) {
                let result = results[i]
                if (result.indexOf("<pre") !== -1) {
                    result = result.replace("</pre>", "")
                    const index = result.indexOf(">")
                    result = result.slice(index + 1)
                }
                const sentences = []

                let idx = 0
                while (true) {
                    const sentenceStartIndex = result.indexOf("<b>", idx)
                    if (sentenceStartIndex === -1) break;
                    
                    const sentenceFinalIndex = result.indexOf("<i>", sentenceStartIndex)
                    
                    if (sentenceFinalIndex === -1) {
                        sentences.push(result.slice(sentenceStartIndex + 3))
                        break
                    } else {
                        sentences.push(result.slice(sentenceStartIndex + 3, sentenceFinalIndex))
                    }
                    idx = sentenceFinalIndex
                }
    
                result = sentences.length > 0 ? sentences.join(" ") : result
                let resultArray = result.match(/\<a\si\=[0-9]+\>[^\<\>]*(?=\<\/a\>)/g)

                let indexes
                if (resultArray && resultArray.length > 0) {
                    indexes = resultArray.map(value => parseInt(value.match(/[0-9]+(?=\>)/g))).filter(value => !isNaN(value))
                    resultArray = resultArray.map(value => {
                        var resultStartAtIndex = value.indexOf('>')
                        return value.slice(resultStartAtIndex + 1)
                    })
                } else {
                    resultArray = [result]
                    indexes = [0]
                }

                resultArray = resultArray.map(value => value.replace(/\<\/b\>/g, ""))
                resultArray = resultArray.map(value => unescapeHTML(value))

                const finalResulArray = []
                for (const j in indexes) {
                    if (finalResulArray[indexes[j]]) {
                        finalResulArray[indexes[j]] += " " + resultArray[j]
                    } else {
                        finalResulArray[indexes[j]] = resultArray[j]
                    }
                }
                
                resultArray3d.push(finalResulArray)
            }
            
            //return fixResultArray(resultArray3d, fixIndexesMap)
            return resultArray3d
        })
    }

    translationService.google.translateText = async function (sourceArray, targetLanguage, dontSaveInCache=false) {
        if (targetLanguage == "zh") {
            targetLanguage = "zh-CN"
        }

        return (await translationService.google.translateHTML(sourceArray.map(value => [value]), targetLanguage, dontSaveInCache, true)).map(value => value[0])
    }

    translationService.google.translateSingleText = function (source, targetLanguage, dontSaveInCache=false) {
        return translationService.google.translateText([source], targetLanguage, dontSaveInCache)
        .then(results => results[0])
    }

    translationService.yandex.translateHTML = function (sourceArray3d, targetLanguage, dontSaveInCache=false) {
        if (targetLanguage.indexOf("zh-") !== -1) {
            targetLanguage = "zh"
        }

        const sourceArray = sourceArray3d.map(sourceArray => {
            return sourceArray
                .map(value => escapeHTML(value))
                .join("<wbr>")
        })

        const requestBody = "format=html&lang=" + targetLanguage
        return translateHTML(
            "yandex",
            targetLanguage,
            "https://translate.yandex.net/api/v1/tr.json/translate?srv=tr-url-widget",
            sourceArray,
            requestBody,
            "text",
            getTranslationInProgress("yandex", targetLanguage),
            dontSaveInCache
        )
        .then(thisTranslationProgress => {
            const results = thisTranslationProgress.map(value => value.translated)

            const resultArray3d = []
            for (const result of results) {
                resultArray3d.push(
                    result
                    .split("<wbr>")
                    .map(value => unescapeHTML(value))
                )
            }

            return resultArray3d
        })
    }

    translationService.yandex.translateText = async function (sourceArray, targetLanguage, dontSaveInCache=false) {
        if (targetLanguage.indexOf("zh-") !== -1) {
            targetLanguage = "zh"
        }

        return (await translationService.yandex.translateHTML(sourceArray.map(value => [value]), targetLanguage, dontSaveInCache)).map(value => value[0])
    }

    translationService.yandex.translateSingleText = function (source, targetLanguage, dontSaveInCache=false) {
        return translationService.yandex.translateText([source], targetLanguage, dontSaveInCache)
        .then(results => results[0])
    }


    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "translateHTML") {
            let translateHTML
            if (request.translationService === "yandex") {
                translateHTML = translationService.yandex.translateHTML
            } else {
                translateHTML = translationService.google.translateHTML
            }

            translateHTML(request.sourceArray3d, request.targetLanguage, sender.tab ? sender.tab.incognito : false)
            .then(results => {
                sendResponse(results)
            })
            .catch(e => {
                sendResponse()
            })

            return true
        } else if (request.action === "translateText") {
            let translateText
            if (request.translationService === "yandex") {
                translateText = translationService.yandex.translateText
            } else {
                translateText = translationService.google.translateText
            }

            translateText(request.sourceArray, request.targetLanguage, sender.tab ? sender.tab.incognito : false)
            .then(results => {
                sendResponse(results)
            })
            .catch(e => {
                sendResponse()
            })

            return true
        } else if (request.action === "translateSingleText") {
            let translateSingleText
            if (request.translationService === "yandex") {
                translateSingleText = translationService.yandex.translateSingleText
            } else {
                translateSingleText = translationService.google.translateSingleText
            }

            translateSingleText(request.source, request.targetLanguage, sender.tab ? sender.tab.incognito : false)
            .then(result => {
                sendResponse(result)
            })
            .catch(e => {
                sendResponse()
            })

            return true          
        }
    })
}