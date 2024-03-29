import { LoggerError } from "./Error";
import { Colores, ColoresLogger } from "./ColoresLogger";
import { LoggerConfig, LoggerConfigE, toString_I } from "./LoggerConfig";

import { resolve, extname, basename } from "path";
import { accessSync, appendFileSync, existsSync, lstatSync } from "fs";
import { R_OK, W_OK } from "constants";

//Exporta las interfaces y errores para permitir ser accesibles desde el propio modulo


/**
 * Enum que define el nivel del log para el registro global 
 */
export enum NIVEL_LOG {
    TODOS = 0,
    LOG = 1,
    INFO = 2,
    AVISO = 3,
    ERROR = 4,
    FATAL = 5,
    NINGUNO = 6
}

/** Formato por defecto */
export const formato_defecto = "(%{T})[%{D}-%{M}-%{Y}, %{H}:%{i}] - %{R}";
/** Formato de error por defecto */
export const formato_error_defecto = "(%{T})[%{D}-%{M}-%{Y}, %{H}:%{i}]( %{N} {%{F},%{L}} [%{E}] - {%{A}}) - %{R}";

declare global {
    interface String {
        /**
         * Permite definir una plantilla como string y compilarla al llamar a este metodo
         * @param args objeto, con un string como clave, y cualquier tipo como valor
         * @returns una Funcion que cambia sustitulle los valores en la plantill
         * @see Codigo de {@link https://stackoverflow.com/questions/29182244/convert-a-string-to-a-template-string/41015840#41015840 StackOverflow}
         */

        compilarPlantilla(args: Record<string, unknown>): Function;
    }
}

String.prototype.compilarPlantilla = function (this: string, args: Record<string, unknown>): Function {
    //Extrae los nombres de la funcion
    const nombres: string[] = Object.keys(args);
    //Extrae los valores
    const valores: unknown[] = Object.values(args);
    //Devuelve una funcion que tiene por parametros todos los nombres de la funcion y devuelve la plantilla con los valores sustituidos
    //Se le pasan por parametro todos los valores, al haberse extraido de un objeto cada valor corresponde con su clave o nombre
    return Function(...nombres, `return \`${this}\``)(...valores);
};

/**
 * Expresion regular por defecto para comprobar la prodecencia de logger
 */
export const exp_logger = /at Logger(_DB)?\.((log)|(info)|(aviso)|(error)|(fatal))_((consola)|(archivo)|(base_datos))/;

/**
 * Expresion regular para comprobar si un error procede de la clase logger
 */
export const exp_logger_generico = /at Logger[0-9A-Z_$]*\.[$A-Z_][0-9A-Z_$]*/i;
/**
 * Clase para el manejo del sistema de logs
 */
export class Logger {

    protected _ruta: string;
    protected _fichero: string;
    protected _formato: string;
    protected _formato_error: string;
    protected _nivel: NIVEL_LOG;
    protected _exp_logger: RegExp;
    protected _codificacion: BufferEncoding;

    /**
     * @param fichero string, nombre, del fichero, por defecto logger.log
     * @param ruta lugar donde se guarda el archivo, por defecto es el directorio raiz
     * @param nivel, NIVEL_LOG, nivel del log permitido para mostrarse, por defecto todos
     * @param formato string, formato normal, tiene un valor por defecto
     * @param formato_error string, formato para cuando se lanza un error, tiene un valor por defecto
     * @param codificacion BufferEncoding, formato de codificacion para el archivo log, por defecto UTF-8
     * @throws LoggerError, si el fichero, la ruta o la codificacion no son validos
     * @remarks 
     * El formato permite caracteres especiales, que seran sustituidos por informacion
     * %{s} - Muestra los segundos,
     * %{i} - Muestra los minutos,
     * %{H} - Muestra las horas
     * %{D} - Muestra el dia,
     * %{M} - Muestra el mes,
     * %{Y} - Muestra el año,
     * %{T} - Muestra el tipo de log,
     * %{F} - Muestra el modulo donde se lanza el error o se llama al metodo,
     * %{A} - Muestra el archivo donde se lanza el error o se llama al metodo,
     * %{R} - Muestra el mensaje pasado al metodo,
     * %{L} - Muestra la linea donde se lanza el error o se llama al metodo,
     * %{N} - Muestra el nombre del error,
     * %{E} - Muestra el mensaje del error,
     * %{CR} - Pinta de color rojo (Consola),
     * %{CA} - Pinta de color azul (Consola),
     * %{CV} - Pinta de color verde (Consola),
     * %{CM} - Pinta de color amarillo (Consola),
     * %{CF} - Marca el fin de coloreado
     */
    public constructor(fichero: string = "logger.log", ruta: string = "./", nivel: NIVEL_LOG = NIVEL_LOG.TODOS, formato: string = formato_defecto, formato_error: string = formato_error_defecto, codificacion: BufferEncoding = "utf-8") {
        this._ruta = this.comprobar_ruta(ruta);
        this._fichero = this.comprobar_fichero(fichero);
        this._formato = this.formatear(formato);
        this._formato_error = this.formatear(formato_error);
        this._nivel = nivel;
        this._exp_logger = new RegExp(exp_logger);
        this._codificacion = this.comprobar_codificacion(codificacion);
    }

    // Getter y Setter de las propiedades
    public get ruta(): string {
        return this._ruta;
    }

    public set ruta(ruta: string) {
        this._ruta = this.comprobar_ruta(ruta);
        this._fichero = this.comprobar_fichero(basename(this._fichero));
    }

    public get fichero(): string {
        return this._fichero;
    }

    public set fichero(fichero: string) {
        this._fichero = this.comprobar_fichero(fichero);
    }

    public get formato(): string {
        return this._formato;
    }

    public set formato(formato: string) {
        this._formato = this.formatear(formato);
    }

    public get formato_error(): string {
        return this._formato_error;
    }

    public set formato_error(formato_error: string) {
        this._formato_error = this.formatear(formato_error);
    }

    public get nivel(): NIVEL_LOG {
        return this._nivel;
    }

    public set nivel(nivel: NIVEL_LOG) {
        this._nivel = nivel;
    }

    public get exp_logger(): RegExp {
        return this._exp_logger;
    }

    public set codificacion(codificacion: BufferEncoding) {
        this._codificacion = this.comprobar_codificacion(codificacion);
    }

    public get codificacion(): BufferEncoding {
        return this._codificacion;
    }

    /**
     * Sustituye caracteres por otros para 
     * @param formato cadena para hacer la sustitucion
     * @returns Cadena con los remplazos hecho
     */
    protected formatear(formato: string): string {

        // Informacion de la fecha
        formato = formato.replace(new RegExp("%{s}", "g"), "${`0${new Date().getSeconds()}`.slice(-2)}");
        formato = formato.replace(new RegExp("%{i}", "g"), "${`0${new Date().getMinutes()}`.slice(-2)}");
        formato = formato.replace(new RegExp("%{H}", "g"), "${new Date().getHours()}");
        formato = formato.replace(new RegExp("%{D}", "g"), "${new Date().getDate()}");
        formato = formato.replace(new RegExp("%{M}", "g"), "${new Date().getMonth() + 1}");
        formato = formato.replace(new RegExp("%{Y}", "g"), "${new Date().getFullYear()}");

        //Informacion general
        formato = formato.replace(new RegExp("%{T}", "g"), "${tipo}");
        formato = formato.replace(new RegExp("%{F}", "g"), "${funcion}");
        formato = formato.replace(new RegExp("%{A}", "g"), "${archivo}");
        formato = formato.replace(new RegExp("%{R}", "g"), "${mensaje}");
        formato = formato.replace(new RegExp("%{L}", "g"), "${linea}");

        //Informacion de los errores
        formato = formato.replace(new RegExp("%{N}", "g"), "${nombre_error}");
        formato = formato.replace(new RegExp("%{E}", "g"), "${mensaje_error}");

        //Colores
        formato = formato.replace(new RegExp("%{CR}", "g"), "${Color.ROJO}");
        formato = formato.replace(new RegExp("%{CA}", "g"), "${Color.AZUL}");
        formato = formato.replace(new RegExp("%{CV}", "g"), "${Color.VERDE}");
        formato = formato.replace(new RegExp("%{CM}", "g"), "${Color.AMARILLO}");
        formato = formato.replace(new RegExp("%{CF}", "g"), "${Color.FINC}");

        return formato;
    }

    /**
     * Metodo para obtener datos del stack de un error
     * @typeParam E - Tipo que desciende de error 
     * @param error E, Error del que se van a obtener los datos
     * @returns Objeto con propiedades del error
     */
    protected obtener_datos_stack<E extends Error>(error: E): { nombre_error: string, mensaje_error: string, funcion: string, linea: string, archivo: string } {
        //Declara la variable con las propiedades de error
        const datos = { nombre_error: error.name, mensaje_error: error.message, funcion: "", linea: "", archivo: "" };
        //Comprueba si stack es indefinido, en caso de serlo lo devuelve
        if (error.stack === undefined) return datos;

        try {
            //Separa stack por lineas
            const elementos = error.stack.split("\n");
            //Obtiene la primera linea que empieza por "at", elimina los espacios del inicio y el final y los separa por 
            //espacios en blanco, optiene las posiciones segunda y tercera del array y las guarda en archivo y linea
            const [, funcion, linea] = elementos[elementos.findIndex((elemento) => {
                elemento = elemento.trim();
                if (/^at/i.test(elemento) && !this._exp_logger.test(elemento)) {
                    return true;
                }
            })].trim().split(" ");
            //Guarda directamante llamada
            datos.funcion = funcion;
            //Separa lina por el signo de dos puntos,
            const linea2 = linea.split(":");
            //Elimina el parentesis del principio de la cadena
            linea2[0] = linea2[0].replace("(", "");
            //Obtiene todas las posiiones del array hasta la penultima y los vuelve a juntar con el signo de doble punto
            datos.archivo = linea2.slice(0, -2).join(":");
            //Obtiene la penultima posicion y obtiene el primer valor del array (slice devuelve un array)
            datos.linea = linea2.slice(-2, -1)[0];
            //Devuelve los datos
            return datos;
        } catch (e) {
            //En caso de que al formatear, salte una excepcion
            return datos;
        }
    }

    /** 
     * Metodo para comprobar el tipo de error.
     * @typeParam E - Tipo que desciende de error 
     * @param error E, error  
     * @returns boolean, si el error ha sido lanzado desde la clase o no
     */
    protected comprobar_tipo_error<E extends Error>(error: E): boolean {
        //Comprueba si el stack del error es undefined, en ese caso devolverá un true
        if (error.stack == undefined) return true;
        //Comprueba si el error es una instancia (directa) de Error y si el error proviene de un metodo de la clase logger
        return error.constructor.name == "Error" && this._exp_logger.test(error.stack);
    }

    /**
     * Comprueba si el string es valido como tipo de codificacion. En caso de no serlo lanzara una excepcion
     * @param codificacion string, tipo de codificacion
     * @throws LoggerError, si la codificacion es no es valida
     * @returns BufferEncoding, 
     */
    protected comprobar_codificacion(codificacion: string): BufferEncoding {
        //Comprueba si no es valido
        if (!Buffer.isEncoding(codificacion)) {
            //En caso de no ser valido lanza la excepcion
            throw new LoggerError("La codificación " + codificacion + " no es válida");
        }
        //Devuelve la codificacion
        return codificacion;
    }

    /**
     * Apartir de un objeto de Configuracion, asigna y devuelve las respectivas configuraciones filtradas
     * @param config LoggerConfig, objeto de configuracion 
     * @param tipo boolean, determina si el formato es normal o de error.
     * @param colores Paleta de colores en caso de que config no lo tengo
     * @returns LoggerConfigE, objeto de configuracion con las configuraciones filtradas
     */
    protected configuracion(config: LoggerConfig, tipo: boolean, colores: ColoresLogger): LoggerConfigE {
        //Comprueba si config tiene establecido formato, en caso de ser asi lo formatea, en caso contrario 
        //apartir del tipo, determina si es un tipo formato normal o error
        const formato = (config.formato) ?
            this.formatear(config.formato) :
            tipo ? this._formato : this._formato_error;

        // Devueleve el objeto
        return {
            //Comprueba config tiene establecido fichero,en caso de ser asi comprueba ,en caso contrario usa el fichero
            //establecido en el objeto
            fichero: config.fichero ? this.comprobar_fichero(config.fichero) : this._fichero,
            //Asigna la constante formato
            formato: formato,
            //Si config no tiene declarado colores asigna el objeto colores pasado por parametro
            colores: config.colores || colores,
            //Devuelve al codificacion especificada
            codificacion: config.codificacion ? this.comprobar_codificacion(config.codificacion) : this._codificacion
        };
    }

    /**
     * Comprueba el directorio donde se guardaran los 
     * @param ruta string, ruta al directorio
     * @throws LoggerError, si la ruta no existe, no es un directorio o no se tiene permisos de lectura y escritura
     * @returns string, en caso de estar todo correcto, la ruta filtrada
     */
    protected comprobar_ruta(ruta: string): string {
        //Obtiene la ruta absoluta en caso de ser relativa
        ruta = resolve(ruta);

        //Comprueba si la ruta no existe o no es un directorio, en caso de ser cierto uno de los dos, lanza un error
        if (!existsSync(ruta) || !lstatSync(ruta).isDirectory()) {
            throw new LoggerError("Error la ruta, " + ruta + " ,no existe o no es un directorio");
        }

        try {
            //Comprueba los permisos del directorio (si no se cumplen lanza una excepcion)
            accessSync(ruta, W_OK | R_OK);
            //Devueve la ruta
            return ruta;
        } catch {
            //Si los permisos no se cumplen lanza un error 
            throw new LoggerError("Error, son necesario permisos de lectura y escritura para el directorio, " + ruta);
        }
    }

    /**
     * Comprueba si un fichero existe dentro de la ruta. Lanza una excepcion en caso de algun error. 
     * Si el fichero no existe omite las comprobaciones. Si existe comprueba tener permisos de escritura y
     * de lectura. Ademas de comprobar de que la extension sea log (evita la sobreescritura de ciertos ficheros).
     * En caso de no cumplirse alguna de las condiciones lanza una excepcion
     * @param fichero string, nombre del fichero con su extension
     * @throws LoggerError, en caso de que el fichero existiera, al no ser un fichero, tener una extension diferente a
     * .log o no tener permisos de lectura y escritura
     * @returns string, ruta absoluta del fichero
     */
    protected comprobar_fichero(fichero: string): string {
        //Obtiene el nombre del fichero eliminando las rutas 
        fichero = basename(fichero);

        //Obtiene la ruta absoluta del fichero a traves de la variable ruta
        fichero = resolve(this._ruta, fichero);

        //Comprueba si ese fichero, o ruta existe
        if (existsSync(fichero)) {
            //Comprueba si es un archivo, sino lanza un error
            if (!lstatSync(fichero).isFile()) {
                throw new LoggerError("Error el fichero, " + fichero + " ,no es un archivo");
            }

            //En caso de que el fichero tenga una extension distinta de log, lanzara un error para evitar la sobre escritura de archivos importantes
            if (extname(fichero) != ".log") {
                throw new LoggerError("El fichero, " + fichero + ", no es un log, por razones de seguridad solo se sobreescribiran archivos log");
            }

            try {
                //Comprueba los permisos de lectura y escritura del fichero, en caso de faltar alguno lanza una excepcion
                accessSync(fichero, W_OK | R_OK);
                //Devuelve el fichero
                return fichero;
            } catch {
                //Lanza una excepcion, en caso de no tener permisos
                throw new LoggerError("Error, son necesario permisos de lectura y escritura para el fichero, " + fichero);
            }
        }

        //Devuelve el fichero
        return fichero;
    }

    /**
     * Muestra un mensaje de log por consola, 
     * @typeParam E - Tipo que desciende de error 
     * @typeParam M - Tipo para el mensaje, debe de implementar el metodo toString()
     * @param nivel, nivel necesario para registrar el log
     * @param tipo string, tipo del mensaje 
     * @param msg M | string, mensaje del log
     * @param config LoggerConfig, configuracion 
     * @param error E, cualquier tipo de error
     */
    protected consola<E extends Error, M extends toString_I>(nivel: NIVEL_LOG, tipo: string, msg: M | string, config: LoggerConfig, error: E): void {
        //Copia el objeto para evitar modificarlo involuntariamente
        config = { ...config };

        //Comprueba si el nivel es mayor al nivel para registrar el log
        if (nivel < this._nivel) return; //Si el nivel es menor no registrara nada
        //Guarda en variables las propiedades del objeto devuelto por obtener_datos_stack
        const { archivo, linea, nombre_error, mensaje_error, funcion } = this.obtener_datos_stack(error);

        //Comprueba si error es instancia (directa) de Error
        //En caso de que el error, utilizado entre otras cosas para saber desde donde se llama al metodo, sea 
        //distinto de Error, valor por defecto
        const tipoE = this.comprobar_tipo_error(error);

        //Elimina la propiedad de fichero y codificacion del objeto de configuracion para evitar, en caso de tener algun valor, hacer
        //las comprobaciones de la configuracion
        delete config.fichero;
        delete config.codificacion;

        //Filtra la configuracion, le pasa el parametro de config, que tipo de formato ha de ser
        //y la paleta de colores por defecto
        const { colores, formato } = this.configuracion(config, tipoE, Colores);

        //Renderiza la plantilla pasandole los valores que han de ser sustituidos
        //Como devuelve una funcion, la convierte a string
        const plantilla = (formato.compilarPlantilla({
            tipo: tipo,
            mensaje: msg.toString(),
            linea: linea,
            nombre_error: nombre_error,
            mensaje_error: mensaje_error,
            archivo: archivo,
            Color: colores,
            funcion: funcion
        })).toString();

        //Muestra el mensaje
        console.log(plantilla);
    }

    /**
     * Muestra un mensaje por consola del tipo LOG
     * @typeParam E - Tipo que desciende de error 
     * @typeParam M - Tipo para el mensaje, debe de implementar el metodo toString()
     * @param msg M | string, mensaje del log
     * @param config LoggerConfig, configuracion 
     * @param error E, error para mostrar en el log
     * @remarks 
     * El parametro error, se usa para obtener el lugar de llamada de la funcion, tambien puede usarse para
     * manejar un mensaje de error. Por defecto error es una instancia de la clase Error.
     */
    public log_consola<E extends Error, M extends toString_I>(msg: M | string, config: LoggerConfig = {}, error: E = <E>new Error()): void {
        this.consola(NIVEL_LOG.LOG, "LOG", msg, config, error);
    }

    /**
     * Muestra un mensaje por consola del tipo INFO
     * @typeParam E - Tipo que desciende de error 
     * @typeParam M - Tipo para el mensaje, debe de implementar el metodo toString()
     * @param msg M | string, mensaje del log
     * @param config LoggerConfig, configuracion 
     * @param error E, error para mostrar en el log
     * @remarks 
     * El parametro error, se usa para obtener el lugar de llamada de la funcion, tambien puede usarse para
     * manejar un mensaje de error. Por defecto error es una instancia de la clase Error.
     */
    public info_consola<E extends Error, M extends toString_I>(msg: M | string, config: LoggerConfig = {}, error: E = <E>new Error()): void {
        //LLama a consola, con tipo 
        this.consola(NIVEL_LOG.INFO, "INFO", msg, config, error);
    }

    /**
     * Muestra un mensaje por consola del tipo AVISO
     * @typeParam E - Tipo que desciende de error 
     * @typeParam M - Tipo para el mensaje, debe de implementar el metodo toString()
     * @param msg M | string, mensaje del log
     * @param config LoggerConfig, configuracion 
     * @param error E, error para mostrar en el log
     * @remarks 
     * El parametro error, se usa para obtener el lugar de llamada de la funcion, tambien puede usarse para
     * manejar un mensaje de error. Por defecto error es una instancia de la clase Error.
     */
    public aviso_consola<E extends Error, M extends toString_I>(msg: M | string, config: LoggerConfig = {}, error: E = <E>new Error()): void {
        //LLama a consola, con tipo 
        this.consola(NIVEL_LOG.AVISO, "AVISO", msg, config, error);
    }

    /**
     * Muestra un mensaje por consola del tipo ERROR
     * @typeParam E - Tipo que desciende de error 
     * @typeParam M - Tipo para el mensaje, debe de implementar el metodo toString()
     * @param msg M | string, mensaje del log
     * @param config LoggerConfig, configuracion 
     * @param error E, error para mostrar en el log
     * @remarks 
     * El parametro error, se usa para obtener el lugar de llamada de la funcion, tambien puede usarse para
     * manejar un mensaje de error. Por defecto error es una instancia de la clase Error.
     */
    public error_consola<E extends Error, M extends toString_I>(msg: M | string, config: LoggerConfig = {}, error: E = <E>new Error()): void {
        this.consola(NIVEL_LOG.ERROR, "ERROR", msg, config, error);
    }

    /**
     * Muestra un mensaje por consola del tipo FATAL
     * @typeParam E - Tipo que desciende de error 
     * @typeParam M - Tipo para el mensaje, debe de implementar el metodo toString()
     * @param msg M | string, mensaje del log
     * @param config LoggerConfig, configuracion 
     * @param error E, error para mostrar en el log
     * @remarks 
     * El parametro error, se usa para obtener el lugar de llamada de la funcion, tambien puede usarse para
     * manejar un mensaje de error. Por defecto error es una instancia de la clase Error.
     */
    public fatal_consola<E extends Error, M extends toString_I>(msg: M | string, config: LoggerConfig = {}, error: E = <E>new Error()): void {
        this.consola(NIVEL_LOG.FATAL, "FATAL", msg, config, error);
    }

    /**
     * Guarda un mensaje de log en el archivo
     * @typeParam E - Tipo que desciende de error 
     * @typeParam M - Tipo para el mensaje, debe de implementar el metodo toString()
     * @param nivel, nivel necesario para registrar el log
     * @param tipo string, tipo del mensaje 
     * @param msg M | string, mensaje del log
     * @param config LoggerConfig, configuracion 
     * @param error E, cualquier tipo de error
     * @throws LoggerError, si el fichero o la codificacion son modificados mediante config y no son validos
     */
    protected archivo<E extends Error, M extends toString_I>(nivel: NIVEL_LOG, tipo: string, msg: M | string, config: LoggerConfig, error: E): void {
        //Copia el objeto para evitar modificarlo involuntariamente
        config = { ...config };

        //Comprueba si el nivel es mayor al nivel para registrar el log
        if (nivel < this._nivel) return; //Si el nivel es menor no registrara nada
        //Guarda en variables las propiedades del objeto devuelto por obtener_datos_stack
        const { archivo, linea, nombre_error, mensaje_error, funcion } = this.obtener_datos_stack(error);

        //Comprueba si error es instancia (directa) de Error
        //En caso de que el error, utilizado entre otras cosas para saber desde donde se llama al metodo, sea 
        //distinto de Error, valor por defecto
        const tipoE = this.comprobar_tipo_error(error);

        //Elimnia la propiedad de colores para evitar, que se establezcan y aparezcan en el archivo
        delete config.colores;

        //Filtra la configuracion, le pasa el parametro de config, que tipo de formato ha de ser
        //y la paleta de colores por defecto, al ser un archivo los colores son vacios
        const { fichero, colores, formato, codificacion } = this.configuracion(config, tipoE, {
            FINC: "",
            ROJO: "",
            VERDE: "",
            AMARILLO: "",
            AZUL: ""
        });

        //Renderiza la plantilla pasandole los valores que han de ser sustituidos
        //Como devuelve una funcion, la convierte a string
        const plantilla = (formato.compilarPlantilla({
            tipo: tipo,
            mensaje: msg.toString(),
            linea: linea,
            nombre_error: nombre_error,
            mensaje_error: mensaje_error,
            archivo: archivo,
            Color: colores,
            funcion: funcion
        })).toString();

        //Añade al final del archivo el mensaje
        appendFileSync(fichero, plantilla + "\n", { encoding: codificacion });
    }

    /**
     * Guarda un mensaje de log en el archivo del Tipo LOG
     * @typeParam E - Tipo que desciende de error 
     * @typeParam M - Tipo para el mensaje, debe de implementar el metodo toString()
     * @param msg M | string, mensaje del log
     * @param config LoggerConfig, configuracion, los colores no deber ser definido o se mostraran sus codigo en los ficheros 
     * @param error E, error para mostrar en el log
     * @throws LoggerError, si el fichero o la codificacion son modificados mediante config y no son validos
     * @remarks 
     * El parametro error, se usa para obtener el lugar de llamada de la funcion, tambien puede usarse para
     * manejar un mensaje de error. Por defecto error es una instancia de la clase Error.
     */
    public log_archivo<E extends Error, M extends toString_I>(msg: M | string, config: LoggerConfig = {}, error: E = <E>new Error()): void {
        this.archivo(NIVEL_LOG.LOG, "LOG", msg, config, error);
    }

    /**
     * Guarda un mensaje de log en el archivo del Tipo INFO
     * @typeParam E - Tipo que desciende de error 
     * @typeParam M - Tipo para el mensaje, debe de implementar el metodo toString()
     * @param msg M | string, mensaje del log
     * @param config LoggerConfig, configuracion, los colores no deber ser definido o se mostraran sus codigo en los ficheros
     * @param error E, error para mostrar en el log
     * @throws LoggerError, si el fichero o la codificacion son modificados mediante config y no son validos
     * @remarks 
     * El parametro error, se us a para obtener el lugar de llamada de la funcion, tambien puede usarse para
     * manejar un mensaje de error. Por defecto error es una instancia de la clase Error.
     */
    public info_archivo<E extends Error, M extends toString_I>(msg: M | string, config: LoggerConfig = {}, error: E = <E>new Error()): void {
        this.archivo(NIVEL_LOG.INFO, "INFO", msg, config, error);
    }

    /**
     * Guarda un mensaje de log en el archivo del Tipo AVISO
     * @typeParam E - Tipo que desciende de error 
     * @typeParam M - Tipo para el mensaje, debe de implementar el metodo toString()
     * @param msg M | string, mensaje del log
     * @param config LoggerConfig, configuracion, los colores no deber ser definido o se mostraran sus codigo en los ficheros
     * @param error E, error para mostrar en el log
     * @throws LoggerError, si el fichero o la codificacion son modificados mediante config y no son validos
     * @remarks 
     * El parametro error, se usa para obtener el lugar de llamada de la funcion, tambien puede usarse para
     * manejar un mensaje de error. Por defecto error es una instancia de la clase Error.
     */
    public aviso_archivo<E extends Error, M extends toString_I>(msg: M | string, config: LoggerConfig = {}, error: E = <E>new Error()): void {
        this.archivo(NIVEL_LOG.AVISO, "AVISO", msg, config, error);
    }

    /**
     * Guarda un mensaje de log en el archivo del Tipo ERROR 
     * @typeParam E - Tipo que desciende de error 
     * @typeParam M - Tipo para el mensaje, debe de implementar el metodo toString()
     * @param msg M | string, mensaje del log
     * @param config LoggerConfig, configuracion, los colores no deber ser definido o se mostraran sus codigo en los ficheros
     * @param error E, error para mostrar en el log
     * @throws LoggerError, si el fichero o la codificacion son modificados mediante config y no son validos
     * @remarks 
     * El parametro error, se usa para obtener el lugar de llamada de la funcion, tambien puede usarse para
     * manejar un mensaje de error. Por defecto error es una instancia de la clase Error.
     */
    public error_archivo<E extends Error, M extends toString_I>(msg: M | string, config: LoggerConfig = {}, error: E = <E>new Error()): void {
        this.archivo(NIVEL_LOG.ERROR, "ERROR", msg, config, error);
    }

    /**
     * Guarda un mensaje de log en el archivo del Tipo FATAL
     * @typeParam E - Tipo que desciende de error 
     * @typeParam M - Tipo para el mensaje, debe de implementar el metodo toString()
     * @param msg M | string, mensaje del log
     * @param config LoggerConfig, configuracion, los colores no deber ser definido o se mostraran sus codigo en los ficheros
     * @param error E, error para mostrar en el log
     * @throws LoggerError, si el fichero o la codificacion son modificados mediante config y no son validos
     * @remarks 
     * El parametro error, se usa para obtener el lugar de llamada de la funcion, tambien puede usarse para
     * manejar un mensaje de error. Por defecto error es una instancia de la clase Error.
     */
    public fatal_archivo<E extends Error, M extends toString_I>(msg: M | string, config: LoggerConfig = {}, error: E = <E>new Error()): void {
        this.archivo(NIVEL_LOG.FATAL, "FATAL", msg, config, error);
    }
}