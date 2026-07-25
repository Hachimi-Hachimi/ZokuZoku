import { CliDatabase } from "./cliDatabase";
import { Database } from "./interfaces/database";
import { extractStatements } from "./queryParser";
import { ResultSet } from "./common";
import { QueryResult } from ".";
import { Statement } from "./interfaces/statement";

export interface QueryExecutionOptions {
    sql: string[]; // sql to execute before executing the query (e.g ATTACH DATABASE <path>; PRAGMA foreign_keys = ON; ecc)
}

export function executeQuery(sqlite3: string, dbPath: string, query: string, options: QueryExecutionOptions = { sql: [] }): Promise<QueryResult> {
    if (!sqlite3) {
        return Promise.reject(new Error(`Unable to execute query: SQLite command is not valid: '${sqlite3}'`));
    }

    /*
    logger.debug(`SQLite3 command: '${sqlite3}'`);
    logger.debug(`Database path: '${dbPath}'`);
    logger.debug(`Query: ${query}`);
    */

    // extract the statements from the query
    let statements: Statement[];
    try {
        statements = extractStatements(query);
    } catch (err) {
        return Promise.reject(`Unable to execute query: ${(err as Error).message}`);
    }

    /*
    logger.debug(`Query execution options: ${JSON.stringify(options)}`);
    logger.debug(`Statements: ${JSON.stringify(statements)}`);
    */

    const resultSet: ResultSet = [];
    let error: Error | undefined;

    return new Promise((resolve, _reject) => {
        const database: Database = new CliDatabase(sqlite3, dbPath, (err) => {
            // there was an error opening the database, reject
            error = err;
        });

        // execute sql before the queries, reject if there is any error
        for (const sql of options.sql) {
            database.execute(sql, (_rows, err) => {
                if (err) {
                    error = new Error(`Failed to setup database: ${err.message}`);
                }
            });
        }

        // execute statements
        for (const statement of statements) {
            database.execute(statement.sql, (rows, err) => {
                if (err) {
                    error = err;
                } else {
                    const header = rows.length > 1 ? rows.shift() : [];
                    resultSet.push({ stmt: statement.sql, header: header!, rows });
                }
            });
        }

        database.close(() => {
            resolve({ resultSet, error });
        });
    });
}