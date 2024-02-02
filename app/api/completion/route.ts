import {AstraDB} from "@datastax/astra-db-ts";
import OpenAI from "openai";

import {CATEGORIES} from "../../../utils/consts";
import {Parea, patchOpenAI, trace} from "parea-ai";


const {
    ASTRA_DB_APPLICATION_TOKEN,
    ASTRA_DB_API_ENDPOINT,
    OPENAI_API_KEY,
    PAREA_API_KEY,
} = process.env;

const astraDb = new AstraDB(ASTRA_DB_APPLICATION_TOKEN, ASTRA_DB_API_ENDPOINT);

const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

new Parea(PAREA_API_KEY);
patchOpenAI(openai);

export async function llm(messages, functions): Promise<string | null> {
    const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo-16k',
        messages,
        temperature: 1,
        functions
    });
    if (functions?.length > 0) {
        return response.choices[0].message.function_call.arguments
    }
    return response.choices[0].message.content ?? '';
}

export async function POST(req: Request) {
    try {
        let docContext = "";
        const collectionName = "article_suggestions";

        try {
            const suggestionsCollection = await astraDb.collection(collectionName);

            const suggestionsDoc = await suggestionsCollection.findOne(
                {
                    _id: "recent_articles"
                },
                {
                    projection: {
                        "recent_articles.metadata.title": 1,
                        "recent_articles.suggested_chunks.content": 1,
                    },
                });

            const docMap = suggestionsDoc.recent_articles.map(article => {
                return {
                    pageTitle: article.metadata.title,
                    content: article.suggested_chunks.map(chunk => chunk.content)
                }
            });

            docContext = JSON.stringify(docMap);
        } catch (e) {
            console.log("Error querying db...");
        }


        const functions = [
            {
                name: 'get_suggestion_and_category',
                description: 'Prints a suggested question and the category it belongs to.',
                parameters: {
                    type: 'object',
                    properties: {
                        questions: {
                            type: 'array',
                            description: 'The suggested questions and their categories.',
                            items: {
                                type: 'object',
                                properties: {
                                    category: {
                                        type: 'string',
                                        enum: CATEGORIES,
                                        description: 'The category of the suggested question.',
                                    },
                                    question: {
                                        type: 'string',
                                        description:
                                            'The suggested question.',
                                    },
                                },
                            },
                        },
                    },
                    required: ['questions'],
                },
            },
        ];

        const messages = [{
            role: "user",
            content: `You are an assistant who creates sample questions to ask a chatbot.
          Given the context below of the most recently added data to the most popular pages on Wikipedia come up with 4 suggested questions
          Only write no more than one question per page and keep them to less than 12 words each
          Do not label which page the question is for/from

          START CONTEXT
          ${docContext}
          END CONTEXT
          `,
        }]

        const chatBot = trace('SampleQuestionsChatbot', llm, {
            endUserIdentifier: 'joel_alexander',
            metadata: {'has_functions': 'functions', "lenContext": docContext.length, "collectionName": collectionName},
        });

        const response = await chatBot(messages, functions);

        return new Response(response);
    } catch (e) {
        throw e;
    }
}
