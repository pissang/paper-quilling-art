module.exports = {
    entry: __dirname + '/src/main.js',
    output: {
        path: __dirname + '/dist',
        filename: 'bundle.js'
    },
    module: {
        rules: [
            // {
            //   test: /\.js$/,
            //   exclude: /node_modules/,
            //   use: {
            //     loader: 'babel-loader'
            //   }
            // },
            {
                test: /\.glsl$/,
                exclude: /node_modules/,
                use: {
                    loader: 'text-loader'
                }
            }
        ]
    }
};