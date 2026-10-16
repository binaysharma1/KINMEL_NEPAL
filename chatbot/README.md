This is a versatile and personalized ai chatbot for our platform.


Today,I started working on some segment of it adn planning..


i decided the workflow will be like, when user try to chat with chatbot,it sends jwt token to express /api/chat then, express validate if user token is valid or not.

if user is authenticated,express route that request to the fastapi endpoint /fastapi/v1/chat ,then model give commadn to the particular designed endpoints within express.

we dont connect chatbot to all the mongodb table as it is not secure.then,express send to mongodb and extract data then ,it goes to model,model process it and give output. 


this workflow is taking so much time and path,it might be slow as model has to take input ,think and generate output two time, 

further in future,we can use jev like models to classify the request type from user request,then forward request in form of command to express and get result. Lets think what will happen with time..




working in real fullstack on different stack is a bit hard than i thought. but will complete slowly..no hurry LMAO>>